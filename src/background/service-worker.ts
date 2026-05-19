import type { TranslationRequest, TranslationResult, VocabularyEntry } from "../shared/types";
import { translateWord } from "../shared/api";
import { getSettings, saveSettings, getCachedTranslation, cacheTranslation, addVocabularyEntry } from "../shared/storage";
import { MESSAGE_TYPES } from "../shared/constants";

interface PendingRequest {
  word: string;
  targetLanguage: string;
  resolve: (result: TranslationResult) => void;
  reject: (error: Error) => void;
}

const pendingQueue: PendingRequest[] = [];
let processing = false;
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1200; // 1.2s between requests for free tier
let consecutive429 = 0;
const recentErrors: { message: string; time: string }[] = [];

function recordError(msg: string) {
  recentErrors.unshift({ message: msg, time: new Date().toLocaleTimeString() });
  if (recentErrors.length > 20) recentErrors.pop();
  chrome.storage.local.set({ linguaflow_last_errors: recentErrors });
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (pendingQueue.length > 0) {
    const req = pendingQueue.shift()!;
    const settings = await getSettings();

    if (!settings.enabled) {
      req.reject(new Error("Extension disabled"));
      continue;
    }

    // Rate limiting: wait minimum interval between requests
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await delay(MIN_INTERVAL_MS - elapsed);
    }

    // Exponential backoff on consecutive 429s
    if (consecutive429 > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, consecutive429), 30000);
      await delay(backoffMs);
    }

    try {
      const cacheKey = `${req.word}:${req.targetLanguage}`;
      const cached = await getCachedTranslation(cacheKey);

      if (cached) {
        consecutive429 = 0;
        lastRequestTime = Date.now();
        req.resolve(cached);
        continue;
      }

      const result = await translateWord({
        word: req.word,
        context: "",
        targetLanguage: req.targetLanguage as TranslationRequest["targetLanguage"],
      });

      consecutive429 = 0;
      lastRequestTime = Date.now();
      await cacheTranslation(cacheKey, result);
      req.resolve(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordError(msg);

      if (msg.includes("429") || msg.includes("rate limit") || msg.includes("Retry in")) {
        consecutive429++;
      } else {
        consecutive429 = 0;
      }

      lastRequestTime = Date.now();
      req.reject(new Error(msg));
    }
  }

  processing = false;
}

function enqueueTranslation(word: string, targetLanguage: string): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ word, targetLanguage, resolve, reject });
    processQueue();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;
  handleMessage(type, payload)
    .then((response) => sendResponse({ success: true, data: response }))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
});

async function handleMessage(type: string, payload: unknown): Promise<unknown> {
  switch (type) {
    case MESSAGE_TYPES.TRANSLATE_WORD: {
      const { word } = payload as { word: string };
      const settings = await getSettings();
      return enqueueTranslation(word, settings.targetLanguage);
    }

    case MESSAGE_TYPES.GET_SETTINGS: {
      return getSettings();
    }

    case MESSAGE_TYPES.SAVE_VOCABULARY: {
      const entry = payload as VocabularyEntry;
      await addVocabularyEntry(entry);
      return { saved: true };
    }

    case MESSAGE_TYPES.CACHE_CLEAR: {
      await chrome.storage.local.remove("linguaflow_translation_cache");
      return { cleared: true };
    }

    case MESSAGE_TYPES.TOGGLE_ENABLED: {
      const settings = await getSettings();
      await saveSettings({ enabled: !settings.enabled });
      return { enabled: !settings.enabled };
    }

    case MESSAGE_TYPES.OPEN_OPTIONS: {
      chrome.runtime.openOptionsPage();
      return { opened: true };
    }

    case MESSAGE_TYPES.TEST_CONNECTION: {
      const settings = await getSettings();

      if (settings.apiProvider === "gemini") {
        if (!settings.geminiApiKey) {
          return { success: false, message: "No Gemini API key. Get one at aistudio.google.com/apikey" };
        }
      } else {
        if (!settings.openrouterApiKey) {
          return { success: false, message: "No OpenRouter API key. Go to Setup tab and enter your key." };
        }
      }

      try {
        const result = await translateWord({
          word: "hello",
          context: "Hello, how are you?",
          targetLanguage: settings.targetLanguage,
        });
        const provider = settings.apiProvider === "gemini" ? "Gemini" : "OpenRouter";
        return { success: true, message: `${provider} OK — hello → ${result.translation || result.definition || "OK"}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        recordError(msg);
        return { success: false, message: msg };
      }
    }

    case MESSAGE_TYPES.GET_ERRORS: {
      return recentErrors;
    }

    case MESSAGE_TYPES.CLEAR_ERRORS: {
      recentErrors.length = 0;
      chrome.storage.local.remove("linguaflow_last_errors");
      return { cleared: true };
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  const hasKey = settings.apiProvider === "gemini" ? settings.geminiApiKey : settings.openrouterApiKey;
  if (!hasKey) {
    console.log(
      "%cLinguaFlow %cinstalled! %cSet your API key in the Setup tab.",
      "color: #6366f1; font-weight: bold",
      "color: #22c55e",
      "color: inherit"
    );
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.linguaflow_settings) {
    const newSettings = changes.linguaflow_settings.newValue;
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: MESSAGE_TYPES.SETTINGS_UPDATED,
            payload: newSettings,
          }).catch(() => {});
        }
      });
    });
  }
});
