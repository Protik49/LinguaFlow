import type { TranslationRequest, TranslationResult } from "./types";
import { getSettings } from "./storage";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_INFO_URL = "https://openrouter.ai/api/v1/key";

// Free models to try. Order rotates so one busy model doesn't block others.
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
];

let currentModelIndex = 0;
// Track models that returned 429 so we skip them temporarily
const throttledModels = new Map<string, number>();

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
  json = json.replace(/```(?:json)?\s*/g, "").trim();

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
    const lines = content.split("\n").filter(Boolean);
    const result: TranslationResult = {
      translation: "", definition: "", pronunciation: "", synonym: "", cachedAt: Date.now(),
    };
    for (const line of lines) {
      const match = line.match(/^(translation|definition|pronunciation|synonym)[:\s]+(.+)/i);
      if (match) {
        const key = match[1].toLowerCase() as keyof TranslationResult;
        if (key in result) (result as Record<string, string>)[key] = match[2].trim();
      }
    }
    return result.translation ? result : null;
  }
  return null;
}

async function callModel(apiKey: string, model: string, request: TranslationRequest): Promise<TranslationResult> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

    // 429 — rate limit. Honor Retry-After header
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "0", 10);
      // Mark this model as throttled
      throttledModels.set(model, Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 10000));

      const waitMsg = retryAfter > 0
        ? `Retry in ${retryAfter}s`
        : "Free tier daily limit reached (200 req/day without credits, 1000 with $5+)";
      throw new Error(`${model}: ${waitMsg}`);
    }

    // 402 — out of credits
    if (response.status === 402) {
      throw new Error(`${model}: Out of credits. Add funds at openrouter.ai/credits`);
    }

    throw new Error(`${model}: ${response.status} — ${parsed?.error?.message || errorText}`);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error(`${model}: no response`);
  }

  const content = data.choices[0].message?.content || "";
  const result = parseResponse(content);
  if (!result) {
    throw new Error(`${model}: failed to parse JSON`);
  }

  return result;
}

function pickModel(): string | null {
  const now = Date.now();

  // Try up to all models, skipping ones currently throttled
  for (let i = 0; i < FREE_MODELS.length; i++) {
    const modelIndex = (currentModelIndex + i) % FREE_MODELS.length;
    const model = FREE_MODELS[modelIndex];
    const throttledUntil = throttledModels.get(model);

    if (!throttledUntil || now >= throttledUntil) {
      // Clear expired throttle
      if (throttledUntil) throttledModels.delete(model);
      currentModelIndex = modelIndex;
      return model;
    }
  }

  return null; // All models throttled
}

export async function translateWord(request: TranslationRequest): Promise<TranslationResult> {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error("API key not configured. Go to Setup tab and enter your OpenRouter API key.");
  }

  const errors: string[] = [];
  let attempts = 0;

  while (attempts < FREE_MODELS.length) {
    const model = pickModel();
    if (!model) break; // All throttled

    try {
      const result = await callModel(settings.apiKey, model, request);
      currentModelIndex = FREE_MODELS.indexOf(model);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      attempts++;
      // If first model was throttled, immediately try the next
    }
  }

  // All models failed — give user the full picture
  const throttled = Array.from(throttledModels.entries())
    .filter(([, until]) => until > Date.now())
    .map(([model, until]) => {
      const secs = Math.ceil((until - Date.now()) / 1000);
      return `${model.split("/").pop()}: ${secs}s remaining`;
    });

  if (throttled.length > 0) {
    throw new Error(
      `All free models are rate-limited. Wait times: ${throttled.join(", ")}. ` +
      `Free tier allows ~200 req/day. Add $5+ credits for 1000/day and priority access.`
    );
  }

  throw new Error(errors.join("; "));
}
