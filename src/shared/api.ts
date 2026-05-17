import type { TranslationRequest, TranslationResult } from "./types";
import { getSettings } from "./storage";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemma-2-9b-it:free";

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
    throw new Error("API key not configured. Please set your OpenRouter API key in extension options.");
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://linguaflow.extension",
      "X-Title": "LinguaFlow",
    },
    body: JSON.stringify({
      model: MODEL,
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
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error("No translation returned from API");
  }

  const content = data.choices[0].message?.content || "";

  const result = parseResponse(content);
  if (!result) {
    throw new Error("Failed to parse translation response");
  }

  return result;
}
