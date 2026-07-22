import type { TranslationRequest, TranslationResult, VocabularyEntry } from "../shared/types";
import { translateWord, translateBatch } from "../shared/api";
import {
  getSettings,
  saveSettings,
  getCachedTranslation,
  cacheTranslation,
  addVocabularyEntry,
  importVocabulary,
  markEntryReviewed,
  getStoredErrors,
  setStoredErrors,
} from "../shared/storage";
import { MESSAGE_TYPES } from "../shared/constants";

async function recordError(msg: string) {
  const errors = await getStoredErrors();
  errors.unshift({ message: msg, time: new Date().toLocaleTimeString() });
  if (errors.length > 20) errors.pop();
  await setStoredErrors(errors);
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
      const { word, context, targetLanguage } = payload as { word: string; context?: string; targetLanguage?: string };
      const settings = await getSettings();
      const language = targetLanguage || settings.targetLanguage;

      if (!settings.enabled) {
        throw new Error("Extension disabled");
      }

      const cacheKey = `${word}:${language}`;
      const cached = await getCachedTranslation(cacheKey);
      if (cached) return cached;

      try {
        const result = await translateWord({
          word,
          context: context || "",
          targetLanguage: language as TranslationRequest["targetLanguage"],
        });
        await cacheTranslation(cacheKey, result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await recordError(msg);
        throw new Error(msg);
      }
    }

    case MESSAGE_TYPES.TRANSLATE_BATCH: {
      const { items, targetLanguage } = payload as {
        items: Array<{ word: string; context?: string }>;
        targetLanguage?: string;
      };
      const settings = await getSettings();
      const language = targetLanguage || settings.targetLanguage;

      if (!settings.enabled) {
        throw new Error("Extension disabled");
      }

      const results: Record<string, TranslationResult> = {};
      const uncachedItems: Array<{ word: string; context?: string }> = [];
      const seenUncached = new Set<string>();

      for (const item of items) {
        const lower = item.word.toLowerCase();
        const cacheKey = `${item.word}:${language}`;
        const cached = await getCachedTranslation(cacheKey);
        if (cached) {
          results[lower] = cached;
        } else if (!seenUncached.has(lower)) {
          seenUncached.add(lower);
          uncachedItems.push(item);
        }
      }

      if (uncachedItems.length > 0) {
        const CHUNK_SIZE = 15;
        for (let i = 0; i < uncachedItems.length; i += CHUNK_SIZE) {
          const chunk = uncachedItems.slice(i, i + CHUNK_SIZE);
          const requests: TranslationRequest[] = chunk.map((item) => ({
            word: item.word,
            context: item.context || "",
            targetLanguage: language as TranslationRequest["targetLanguage"],
          }));

          try {
            const batchResults = await translateBatch(requests);
            for (const [w, res] of Object.entries(batchResults)) {
              results[w] = res;
              await cacheTranslation(`${w}:${language}`, res);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await recordError(msg);
            if (Object.keys(results).length === 0) throw new Error(msg);
          }

          if (i + CHUNK_SIZE < uncachedItems.length) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      return results;
    }

    case MESSAGE_TYPES.GET_SETTINGS: {
      return getSettings();
    }

    case MESSAGE_TYPES.SAVE_VOCABULARY: {
      const entry = payload as VocabularyEntry;
      await addVocabularyEntry(entry);
      await updateBadgeCount();
      return { saved: true };
    }

    case MESSAGE_TYPES.IMPORT_VOCABULARY: {
      const entries = payload as VocabularyEntry[];
      const result = await importVocabulary(entries);
      await updateBadgeCount();
      return result;
    }

    case MESSAGE_TYPES.MARK_REVIEWED: {
      const { id } = payload as { id: string };
      await markEntryReviewed(id);
      return { reviewed: true };
    }

    case MESSAGE_TYPES.CACHE_CLEAR: {
      await chrome.storage.local.remove("linguaflow_translation_cache");
      return { cleared: true };
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
        await recordError(msg);
        return { success: false, message: msg };
      }
    }

    case MESSAGE_TYPES.GET_ERRORS: {
      return getStoredErrors();
    }

    case MESSAGE_TYPES.CLEAR_ERRORS: {
      await setStoredErrors([]);
      return { cleared: true };
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

async function updateBadgeCount() {
  try {
    const result = await chrome.storage.local.get("linguaflow_vocabulary");
    const count = (result.linguaflow_vocabulary || []).length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  } catch {
    // Badge API may not be available in all contexts
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await saveSettings({ onboarded: false });
    chrome.runtime.openOptionsPage();
  }

  await updateBadgeCount();
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
          });
        }
      });
    });
  }

  if (changes.linguaflow_vocabulary) {
    updateBadgeCount();
  }
});
