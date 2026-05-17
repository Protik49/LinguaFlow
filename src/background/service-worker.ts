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
const recentErrors: { message: string; time: string }[] = [];

function debounce(fn: () => void, ms: number) {
  let timeout: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, ms);
  };
}

function recordError(msg: string) {
  recentErrors.unshift({ message: msg, time: new Date().toLocaleTimeString() });
  if (recentErrors.length > 20) recentErrors.pop();
  chrome.storage.local.set({ linguaflow_last_errors: recentErrors });
}

const processQueue = debounce(async () => {
  if (processing) return;
  processing = true;

  while (pendingQueue.length > 0) {
    const batch = pendingQueue.splice(0, 3);
    const settings = await getSettings();

    if (!settings.enabled) {
      batch.forEach((req) => req.reject(new Error("Extension disabled")));
      continue;
    }

    await Promise.all(
      batch.map(async (req) => {
        try {
          const cacheKey = `${req.word}:${req.targetLanguage}`;
          const cached = await getCachedTranslation(cacheKey);

          if (cached) {
            req.resolve(cached);
            return;
          }

          const result = await translateWord({
            word: req.word,
            context: "",
            targetLanguage: req.targetLanguage as TranslationRequest["targetLanguage"],
          });

          await cacheTranslation(cacheKey, result);
          req.resolve(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          recordError(msg);
          req.reject(new Error(msg));
        }
      })
    );
  }

  processing = false;
}, 200);

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
      if (!settings.apiKey) {
        return { success: false, message: "No API key set. Go to Setup tab and enter your OpenRouter API key." };
      }
      try {
        const result = await translateWord({
          word: "hello",
          context: "Hello, how are you?",
          targetLanguage: settings.targetLanguage,
        });
        return { success: true, message: `Connected! Test: hello → ${result.translation || result.definition || "OK"}` };
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
  if (!settings.apiKey) {
    console.log(
      "%cLinguaFlow %cinstalled! %cSet your OpenRouter API key in extension options.",
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
