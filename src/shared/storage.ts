import type { UserSettings, VocabularyEntry, TranslationResult } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SPACED_REPETITION_INTERVALS } from "./constants";

const SETTINGS_KEY = "linguaflow_settings";
const VOCABULARY_KEY = "linguaflow_vocabulary";
const CACHE_KEY = "linguaflow_translation_cache";
const ERRORS_KEY = "linguaflow_last_errors";
const SESSION_KEY = "linguaflow_session";

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY];
  if (!stored) return DEFAULT_SETTINGS;

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

export async function importVocabulary(entries: VocabularyEntry[]): Promise<{ imported: number; skipped: number }> {
  const vocab = await getVocabulary();
  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.word || !entry.translation) {
      skipped++;
      continue;
    }
    const existing = vocab.findIndex(
      (v) => v.word.toLowerCase() === entry.word.toLowerCase() && v.targetLanguage === entry.targetLanguage
    );
    if (existing >= 0) {
      vocab[existing] = { ...vocab[existing], ...entry };
      skipped++;
    } else {
      vocab.unshift({
        id: entry.id || generateVocabularyId(),
        word: entry.word,
        translation: entry.translation,
        definition: entry.definition || "",
        pronunciation: entry.pronunciation || "",
        synonym: entry.synonym || "",
        context: entry.context || "",
        sourceUrl: entry.sourceUrl || "",
        targetLanguage: entry.targetLanguage || "English",
        savedAt: entry.savedAt || Date.now(),
        reviewCount: entry.reviewCount || 0,
        nextReviewAt: entry.nextReviewAt || Date.now() + SPACED_REPETITION_INTERVALS[0],
      });
      imported++;
    }
  }

  await saveVocabulary(vocab);
  return { imported, skipped };
}

export async function markEntryReviewed(id: string): Promise<void> {
  const vocab = await getVocabulary();
  const entry = vocab.find((v) => v.id === id);
  if (!entry) return;

  entry.reviewCount = (entry.reviewCount || 0) + 1;
  const intervalIndex = Math.min(entry.reviewCount - 1, SPACED_REPETITION_INTERVALS.length - 1);
  entry.nextReviewAt = Date.now() + SPACED_REPETITION_INTERVALS[intervalIndex];
  await saveVocabulary(vocab);
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

export function escapeCsv(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function vocabToCSV(vocab: VocabularyEntry[]): string {
  const headers = ["Word", "Translation", "Definition", "Pronunciation", "Synonym", "Context", "Language", "Saved At"];
  const rows = vocab.map((v) =>
    [
      escapeCsv(v.word),
      escapeCsv(v.translation),
      escapeCsv(v.definition),
      escapeCsv(v.pronunciation),
      escapeCsv(v.synonym),
      escapeCsv(v.context),
      escapeCsv(v.targetLanguage),
      escapeCsv(new Date(v.savedAt).toISOString()),
    ].join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

export async function exportVocabulary(format: "json" | "csv" = "json"): Promise<string> {
  const vocab = await getVocabulary();

  if (format === "csv") {
    return vocabToCSV(vocab);
  }

  return JSON.stringify(vocab, null, 2);
}

export function parseVocabularyImport(
  text: string,
  format: "json" | "csv"
): VocabularyEntry[] {
  if (format === "json") {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item: Record<string, unknown>) => ({
        id: String(item.id || generateVocabularyId()),
        word: String(item.word || ""),
        translation: String(item.translation || ""),
        definition: String(item.definition || ""),
        pronunciation: String(item.pronunciation || ""),
        synonym: String(item.synonym || ""),
        context: String(item.context || ""),
        sourceUrl: String(item.sourceUrl || ""),
        targetLanguage: (String(item.targetLanguage || item.language || "English")) as VocabularyEntry["targetLanguage"],
        savedAt: Number(item.savedAt || item.saved_at || Date.now()),
        reviewCount: Number(item.reviewCount || item.review_count || 0),
        nextReviewAt: Number(item.nextReviewAt || item.next_review_at || Date.now() + SPACED_REPETITION_INTERVALS[0]),
      }));
    } catch {
      return [];
    }
  }

  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const entries: VocabularyEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 2) continue;
    entries.push({
      id: generateVocabularyId(),
      word: fields[0] || "",
      translation: fields[1] || "",
      definition: fields[2] || "",
      pronunciation: fields[3] || "",
      synonym: fields[4] || "",
      context: fields[5] || "",
      targetLanguage: (fields[6] || "English") as VocabularyEntry["targetLanguage"],
      sourceUrl: "",
      savedAt: fields[7] ? new Date(fields[7]).getTime() : Date.now(),
      reviewCount: 0,
      nextReviewAt: Date.now() + SPACED_REPETITION_INTERVALS[0],
    });
  }
  return entries;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

export interface SessionState {
  pendingQueue: Array<{
    word: string;
    targetLanguage: string;
    context: string;
    resolveId: string;
  }>;
  processing: boolean;
  lastRequestTime: number;
  consecutive429: number;
}

const DEFAULT_SESSION: SessionState = {
  pendingQueue: [],
  processing: false,
  lastRequestTime: 0,
  consecutive429: 0,
};

export async function getSessionState(): Promise<SessionState> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return { ...DEFAULT_SESSION, ...(result[SESSION_KEY] || {}) };
}

export async function setSessionState(state: Partial<SessionState>): Promise<void> {
  const current = await getSessionState();
  await chrome.storage.session.set({ [SESSION_KEY]: { ...current, ...state } });
}

export async function getStoredErrors(): Promise<{ message: string; time: string }[]> {
  const result = await chrome.storage.local.get(ERRORS_KEY);
  return result[ERRORS_KEY] || [];
}

export async function setStoredErrors(errors: { message: string; time: string }[]): Promise<void> {
  await chrome.storage.local.set({ [ERRORS_KEY]: errors });
}
