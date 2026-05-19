import type { UserSettings, VocabularyEntry, TranslationResult } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const SETTINGS_KEY = "linguaflow_settings";
const VOCABULARY_KEY = "linguaflow_vocabulary";
const CACHE_KEY = "linguaflow_translation_cache";

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY];
  if (!stored) return DEFAULT_SETTINGS;

  // Migrate old "apiKey" field to "openrouterApiKey"
  if (stored.apiKey && !stored.openrouterApiKey) {
    stored.openrouterApiKey = stored.apiKey;
    delete stored.apiKey;
    await chrome.storage.local.set({ [SETTINGS_KEY]: stored });
  }

  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
}

export async function getVocabulary(): Promise<VocabularyEntry[]> {
  const result = await chrome.storage.local.get(VOCABULARY_KEY);
  return result[VOCABULARY_KEY] || [];
}

export async function saveVocabulary(entries: VocabularyEntry[]): Promise<void> {
  await chrome.storage.local.set({ [VOCABULARY_KEY]: entries });
}

export async function addVocabularyEntry(entry: VocabularyEntry): Promise<void> {
  const vocab = await getVocabulary();
  const existing = vocab.findIndex((v) => v.word === entry.word && v.targetLanguage === entry.targetLanguage);
  if (existing >= 0) {
    vocab[existing] = { ...vocab[existing], ...entry, savedAt: Date.now() };
  } else {
    vocab.unshift(entry);
  }
  await saveVocabulary(vocab);
}

export async function removeVocabularyEntry(id: string): Promise<void> {
  const vocab = await getVocabulary();
  const filtered = vocab.filter((v) => v.id !== id);
  await saveVocabulary(filtered);
}

export async function getTranslationCache(): Promise<Record<string, TranslationResult>> {
  const result = await chrome.storage.local.get(CACHE_KEY);
  return result[CACHE_KEY] || {};
}

export async function setTranslationCache(cache: Record<string, TranslationResult>): Promise<void> {
  const trimmed = trimCache(cache);
  await chrome.storage.local.set({ [CACHE_KEY]: trimmed });
}

export async function getCachedTranslation(key: string): Promise<TranslationResult | null> {
  const cache = await getTranslationCache();
  const entry = cache[key];
  if (!entry) return null;

  const age = Date.now() - entry.cachedAt;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (age > sevenDays) {
    delete cache[key];
    await setTranslationCache(cache);
    return null;
  }

  return entry;
}

export async function cacheTranslation(
  key: string,
  result: TranslationResult
): Promise<void> {
  const cache = await getTranslationCache();
  cache[key] = { ...result, cachedAt: Date.now() };
  await setTranslationCache(cache);
}

function trimCache(cache: Record<string, TranslationResult>): Record<string, TranslationResult> {
  const entries = Object.entries(cache);
  if (entries.length <= 5000) return cache;

  const sorted = entries.sort((a, b) => b[1].cachedAt - a[1].cachedAt);
  const trimmed = sorted.slice(0, 5000);
  return Object.fromEntries(trimmed);
}

export function generateVocabularyId(): string {
  return `vocab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function exportVocabulary(format: "json" | "csv" = "json"): Promise<string> {
  const vocab = await getVocabulary();

  if (format === "csv") {
    const headers = ["Word", "Translation", "Definition", "Pronunciation", "Synonym", "Context", "Language", "Saved At"];
    const rows = vocab.map((v) =>
      [
        `"${v.word}"`,
        `"${v.translation}"`,
        `"${v.definition}"`,
        `"${v.pronunciation}"`,
        `"${v.synonym}"`,
        `"${v.context}"`,
        `"${v.targetLanguage}"`,
        `"${new Date(v.savedAt).toISOString()}"`,
      ].join(",")
    );
    return [headers.join(","), ...rows].join("\n");
  }

  return JSON.stringify(vocab, null, 2);
}
