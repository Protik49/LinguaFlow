import type { TranslationRequest, TranslationResult } from "./types";
import { getSettings } from "./storage";

/* ── API Endpoints ── */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent";

/* ── Prompts ── */

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

/* ── JSON Parser ── */

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
    type TranslationField = "translation" | "definition" | "pronunciation" | "synonym";
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
        const key = match[1].toLowerCase() as TranslationField;
        result[key] = match[2].trim();
      }
    }
    return result.translation ? result : null;
  }
  return null;
}

/* ── OpenRouter API ── */

async function callOpenRouter(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://linguaflow.extension",
      "X-Title": "LinguaFlow",
    },
    body: JSON.stringify({
      model: "google/gemma-4-31b-it:free",
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
    type ApiError = { error?: { message?: string } };
    let parsed: ApiError | undefined;
    try { parsed = JSON.parse(errorText) as ApiError; } catch { /* ignore */ }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "0", 10);
      const waitMsg = retryAfter > 0
        ? `Rate limited. Retry in ${retryAfter}s`
        : "Rate limited. Free tier limit reached. Wait or switch to Gemini API.";
      throw new Error(waitMsg);
    }
    if (response.status === 402) {
      throw new Error("OpenRouter: out of credits. Add funds at openrouter.ai/credits");
    }
    throw new Error(parsed?.error?.message || `OpenRouter error ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const result = parseResponse(content);
  if (!result) throw new Error("Failed to parse translation response");
  return result;
}

/* ── Gemini API ── */

async function callGemini(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
  const userPrompt = `Word: ${request.word}
Context: ${request.context || "None"}
Language: ${request.targetLanguage}

Output ONLY a JSON object like this, nothing else:
{"translation":"the translation","definition":"brief meaning","pronunciation":"how to say it","synonym":"similar word"}`;

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: userPrompt }],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    type ApiError = { error?: { message?: string } };
    let parsed: ApiError | undefined;
    try { parsed = JSON.parse(errorText) as ApiError; } catch { /* ignore */ }

    if (response.status === 429) {
      throw new Error("Gemini API: rate limited. Wait and retry, or switch to OpenRouter in Setup.");
    }
    throw new Error(parsed?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Gemini API: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!content) {
    throw new Error("Gemini API returned empty response");
  }

  const result = parseResponse(content);
  if (!result) throw new Error(`Failed to parse Gemini response. Raw: ${content.substring(0, 200)}`);
  return result;
}

/* ── Batch Prompts & Parsers ── */

function buildBatchSystemPrompt(targetLanguage: string): string {
  return `You are a precise vocabulary translation assistant. Your task is to translate multiple words into ${targetLanguage}.

Given a JSON list of word items (each with "word" and optional "context"), return ONLY a valid JSON object mapping each original word (in lowercase) to an object with:
- "translation": translation in ${targetLanguage}
- "definition": brief definition in ${targetLanguage} (max 10 words)
- "pronunciation": pronunciation guide for original word
- "synonym": one synonym in ${targetLanguage} or empty string

Format:
{
  "word1": {"translation":"...","definition":"...","pronunciation":"...","synonym":"..."},
  "word2": {"translation":"...","definition":"...","pronunciation":"...","synonym":"..."}
}

Rules:
- Output ONLY valid JSON. No markdown code fences, no explanation.
- Keep values concise.`;
}

function parseBatchResponse(content: string): Record<string, TranslationResult> {
  let json = content.trim();
  json = json.replace(/```(?:json)?\s*/g, "").trim();

  const braceStart = json.indexOf("{");
  const braceEnd = json.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    json = json.substring(braceStart, braceEnd + 1);
  }

  const results: Record<string, TranslationResult> = {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) {
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === "object" && val !== null) {
          const item = val as Record<string, unknown>;
          results[key.toLowerCase()] = {
            translation: String(item.translation || ""),
            definition: String(item.definition || ""),
            pronunciation: String(item.pronunciation || ""),
            synonym: String(item.synonym || ""),
            cachedAt: Date.now(),
          };
        }
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return results;
}

/* ── OpenRouter API Batch ── */

async function callOpenRouterBatch(
  apiKey: string,
  requests: TranslationRequest[]
): Promise<Record<string, TranslationResult>> {
  if (requests.length === 0) return {};
  const targetLanguage = requests[0].targetLanguage;
  const items = requests.map((r) => ({ word: r.word, context: r.context }));

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://linguaflow.extension",
      "X-Title": "LinguaFlow",
    },
    body: JSON.stringify({
      model: "google/gemma-4-31b-it:free",
      messages: [
        { role: "system", content: buildBatchSystemPrompt(targetLanguage) },
        { role: "user", content: JSON.stringify(items) },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    type ApiError = { error?: { message?: string } };
    let parsed: ApiError | undefined;
    try { parsed = JSON.parse(errorText) as ApiError; } catch { /* ignore */ }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "0", 10);
      const waitMsg = retryAfter > 0
        ? `Rate limited. Retry in ${retryAfter}s`
        : "Rate limited. Free tier limit reached. Wait or switch to Gemini API.";
      throw new Error(waitMsg);
    }
    if (response.status === 402) {
      throw new Error("OpenRouter: out of credits. Add funds at openrouter.ai/credits");
    }
    throw new Error(parsed?.error?.message || `OpenRouter error ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseBatchResponse(content);
}

/* ── Gemini API Batch ── */

async function callGeminiBatch(
  apiKey: string,
  requests: TranslationRequest[]
): Promise<Record<string, TranslationResult>> {
  if (requests.length === 0) return {};
  const targetLanguage = requests[0].targetLanguage;
  const items = requests.map((r) => ({ word: r.word, context: r.context }));

  const userPrompt = `${buildBatchSystemPrompt(targetLanguage)}

Words to translate:
${JSON.stringify(items)}`;

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: userPrompt }],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1500,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    type ApiError = { error?: { message?: string } };
    let parsed: ApiError | undefined;
    try { parsed = JSON.parse(errorText) as ApiError; } catch { /* ignore */ }

    if (response.status === 429) {
      throw new Error("Gemini API: rate limited. Wait and retry, or switch to OpenRouter in Setup.");
    }
    throw new Error(parsed?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Gemini API: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!content) {
    throw new Error("Gemini API returned empty response");
  }

  return parseBatchResponse(content);
}

/* ── Main translate function ── */

export async function translateWord(request: TranslationRequest): Promise<TranslationResult> {
  const settings = await getSettings();

  if (settings.apiProvider === "gemini") {
    if (!settings.geminiApiKey) {
      throw new Error("Gemini API key not configured. Get one at aistudio.google.com/apikey");
    }
    return callGemini(settings.geminiApiKey, request);
  }

  // Default: OpenRouter
  if (!settings.openrouterApiKey) {
    throw new Error("OpenRouter API key not configured. Go to Setup tab and enter your key.");
  }
  return callOpenRouter(settings.openrouterApiKey, request);
}

export async function translateBatch(requests: TranslationRequest[]): Promise<Record<string, TranslationResult>> {
  if (requests.length === 0) return {};
  const settings = await getSettings();

  if (settings.apiProvider === "gemini") {
    if (!settings.geminiApiKey) {
      throw new Error("Gemini API key not configured. Get one at aistudio.google.com/apikey");
    }
    return callGeminiBatch(settings.geminiApiKey, requests);
  }

  if (!settings.openrouterApiKey) {
    throw new Error("OpenRouter API key not configured. Go to Setup tab and enter your key.");
  }
  return callOpenRouterBatch(settings.openrouterApiKey, requests);
}

