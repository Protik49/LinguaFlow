import { MESSAGE_TYPES } from "../shared/constants";
import type { PageWord, UserSettings } from "../shared/types";
import { shouldTranslate } from "../shared/wordlists";
import { collectTextNodes, isSkipNode } from "./utils/dom-scanner";

let settings: UserSettings | null = null;

async function initSettings(): Promise<UserSettings> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await new Promise<UserSettings>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve(response.data as UserSettings);
          } else {
            reject(new Error("No response from background"));
          }
        });
      });
      return result;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return {
    targetLanguage: "Bengali",
    difficulty: "intermediate",
    enabled: true,
    apiProvider: "openrouter",
    openrouterApiKey: "",
    geminiApiKey: "",
    maxTranslationsPerPage: 75,
    onboarded: false,
  };
}

function extractPageWords(): PageWord[] {
  if (!settings || !settings.enabled) return [];

  const body = document.body;
  if (!body) return [];

  const textNodes = collectTextNodes(body);
  const words: PageWord[] = [];
  const seen = new Set<string>();
  const MAX_WORDS = settings.maxTranslationsPerPage || 150;

  for (const textNode of textNodes) {
    if (words.length >= MAX_WORDS) break;

    const parent = textNode.parentElement;
    if (!parent || isSkipNode(parent)) continue;

    const text = textNode.textContent || "";
    if (text.trim().length < 3) continue;

    const wordRegex = /[a-zA-Z]{3,}/g;
    let match: RegExpExecArray | null;

    while ((match = wordRegex.exec(text)) !== null) {
      if (words.length >= MAX_WORDS) break;

      const word = match[0];
      const lower = word.toLowerCase();
      if (seen.has(lower)) continue;

      const isCapitalized = /^[A-Z][a-z]+$/.test(word);
      const prevChars = text.substring(0, match.index).trim();
      const isStartOfSentence = prevChars.length === 0 || /[.!?]\s*$/.test(prevChars);

      if (shouldTranslate(word, settings.difficulty, isCapitalized, isStartOfSentence)) {
        seen.add(lower);
        words.push({
          word,
          context: text.substring(Math.max(0, match.index - 40), match.index + word.length + 60).trim(),
        });
      }
    }
  }

  return words;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case MESSAGE_TYPES.GET_PAGE_VOCAB: {
      const raw = message.payload as { difficulty?: string } | undefined;
      if (raw?.difficulty && settings) {
        settings = { ...settings, difficulty: raw.difficulty as UserSettings["difficulty"] };
      }
      const words = extractPageWords();
      sendResponse({ success: true, data: words });
      return false;
    }

    case MESSAGE_TYPES.SETTINGS_UPDATED: {
      if (message.payload) {
        settings = message.payload as UserSettings;
      }
      sendResponse({ success: true });
      return false;
    }
  }
});

async function init() {
  settings = await initSettings();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
