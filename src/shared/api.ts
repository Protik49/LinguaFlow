import type { TranslationRequest, TranslationResult } from "./types";
import { getSettings } from "./storage";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Free models to try in order. If one hits rate limits, we fall back to the next.
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
];

let currentModelIndex = 0;

function buildSystemPrompt(targetLanguage: string): string {
  return `You are a precise vocabulary translation assistant. Your ONLY task is to translate individual words/phrases and provide concise lexical information.

Given a word and its surrounding context, respond with ONLY a valid JSON object. Do NOT wrap it in markdown code fences. Output ONLY the raw JSON:
{"translation":"translation in ${targetLanguage}","definition":"brief definition in ${targetLanguage} (max 10 words)","pronunciation":"pronunciation guide for the ORIGINAL word","synonym":"one synonym or similar word in ${targetLanguage}, or empty string if none"}

Rules:
- Context matters: choose the translation that fits the given context
- Keep all values concise (under 15 words each)
- Output ONLY the JSON object, nothing else — no markdown, no explanation
- If the word is very common and has no meaningful translation value, set translation to empty string`;
}

function buildUserPrompt(word: string, context: string, targetLanguage: string): string {
  return `Word: "${word}"
Context: "${context || "No context provided"}"
Translate to: ${targetLanguage}`;
}

function parseResponse(content: string): TranslationResult | null {
  let json = content.trim();

  // Strip markdown code fences
  json = json.replace(/```(?:json)?\s*/g, "").trim();

  // Find the JSON object in the response
  const braceStart = json.indexOf("{");
  const braceEnd = json.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    json = json.substring(braceStart, braceEnd + 1);
  }

  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        translation: String(parsed.translation || ""),
        definition: String(parsed.definition || ""),
        pronunciation: String(parsed.pronunciation || ""),
        synonym: String(parsed.synonym || ""),
        cachedAt: Date.now(),
      };
    }
  } catch {
    // Try line-by-line parsing as fallback
    const lines = content.split("\n").filter(Boolean);
    const result: TranslationResult = {
      translation: "",
      definition: "",
      pronunciation: "",
      synonym: "",
      cachedAt: Date.now(),
    };
    for (const line of lines) {
      const match = line.match(/^(translation|definition|pronunciation|synonym)[:\s]+(.+)/i);
      if (match) {
        const key = match[1].toLowerCase() as keyof TranslationResult;
        if (key in result) {
          (result as Record<string, string>)[key] = match[2].trim();
        }
      }
    }
    return result.translation ? result : null;
  }
  return null;
}

export async function translateWord(request: TranslationRequest): Promise<TranslationResult> {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error("API key not configured. Go to Setup tab and enter your OpenRouter API key.");
  }

  const errors: string[] = [];

  for (let i = 0; i < FREE_MODELS.length; i++) {
    const modelIndex = (currentModelIndex + i) % FREE_MODELS.length;
    const model = FREE_MODELS[modelIndex];

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://linguaflow.extension",
          "X-Title": "LinguaFlow",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: buildSystemPrompt(request.targetLanguage) },
            { role: "user", content: buildUserPrompt(request.word, request.context, request.targetLanguage) },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsed: any;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }

        // Check for rate limit
        if (response.status === 429) {
          const msg = parsed?.error?.message || errorText;
          if (msg.includes("rate-limited") || msg.includes("rate limit") || msg.includes("429")) {
            errors.push(`${model}: rate limited (free tier busy)`);
            continue; // Try next model
          }
        }

        errors.push(`${model}: ${response.status} — ${parsed?.error?.message || errorText}`);
        continue;
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        errors.push(`${model}: no response`);
        continue;
      }

      const content = data.choices[0].message?.content || "";
      const result = parseResponse(content);
      if (!result) {
        errors.push(`${model}: failed to parse JSON`);
        continue;
      }

      // Remember which model worked for next time
      currentModelIndex = modelIndex;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${model}: ${msg}`);
    }
  }

  // All models failed
  const allBusy = errors.every((e) => e.includes("rate limited"));
  if (allBusy) {
    throw new Error(
      "All free models are rate-limited right now. " +
      "Wait a minute and try again, or add $5 credits to OpenRouter for priority access."
    );
  }
  throw new Error(errors.join("; "));
}
