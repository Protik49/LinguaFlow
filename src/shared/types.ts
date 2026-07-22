export type TargetLanguage =
  | "English"
  | "Bengali"
  | "Hindi"
  | "Arabic"
  | "Spanish"
  | "Japanese"
  | "French"
  | "German"
  | "Korean"
  | "Chinese"
  | "Portuguese"
  | "Russian"
  | "Italian"
  | "Turkish";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface TranslationResult {
  translation: string;
  definition: string;
  pronunciation: string;
  synonym: string;
  cachedAt: number;
}

export type ApiProvider = "openrouter" | "gemini";

export interface UserSettings {
  targetLanguage: TargetLanguage;
  difficulty: Difficulty;
  enabled: boolean;
  apiProvider: ApiProvider;
  openrouterApiKey: string;
  geminiApiKey: string;
  maxTranslationsPerPage: number;
  onboarded: boolean;
}

export interface VocabularyEntry {
  id: string;
  word: string;
  translation: string;
  definition: string;
  pronunciation: string;
  synonym: string;
  context: string;
  sourceUrl: string;
  targetLanguage: TargetLanguage;
  savedAt: number;
  reviewCount: number;
  nextReviewAt: number;
}

export interface TranslationRequest {
  word: string;
  context: string;
  targetLanguage: TargetLanguage;
}

export interface TranslationCacheEntry {
  result: TranslationResult;
  cachedAt: number;
}

export interface PageWord {
  word: string;
  context: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  targetLanguage: "Bengali",
  difficulty: "intermediate",
  enabled: true,
  apiProvider: "openrouter",
  openrouterApiKey: "",
  geminiApiKey: "",
  maxTranslationsPerPage: 75,
  onboarded: false,
};

export const LANGUAGE_OPTIONS: { value: TargetLanguage; label: string }[] = [
  { value: "English", label: "English" },
  { value: "Bengali", label: "বাংলা (Bengali)" },
  { value: "Hindi", label: "हिन्दी (Hindi)" },
  { value: "Arabic", label: "العربية (Arabic)" },
  { value: "Spanish", label: "Español (Spanish)" },
  { value: "Japanese", label: "日本語 (Japanese)" },
  { value: "French", label: "Français (French)" },
  { value: "German", label: "Deutsch (German)" },
  { value: "Korean", label: "한국어 (Korean)" },
  { value: "Chinese", label: "中文 (Chinese)" },
  { value: "Portuguese", label: "Português (Portuguese)" },
  { value: "Russian", label: "Русский (Russian)" },
  { value: "Italian", label: "Italiano (Italian)" },
  { value: "Turkish", label: "Türkçe (Turkish)" },
];
