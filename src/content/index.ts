import { MESSAGE_TYPES } from "../shared/constants";
import type { TranslationResult, UserSettings, VocabularyEntry } from "../shared/types";
import { shouldTranslate } from "../shared/wordlists";
import { walkTextNodes, createObserver } from "./utils/dom-scanner";
import { showTooltip, hideTooltip } from "./components/tooltip";
import { generateVocabularyId } from "../shared/storage";

interface WordState {
  element: HTMLElement;
  word: string;
  result: TranslationResult | null;
  loading: boolean;
  error: string | null;
  saved: boolean;
}

const wordStateMap = new WeakMap<HTMLElement, WordState>();
const translatedWords = new Set<string>();
let settings: UserSettings | null = null;
let observer: MutationObserver | null = null;
let scanTimeout: ReturnType<typeof setTimeout> | null = null;
let translationQueue: Array<{ element: HTMLElement; word: string }> = [];
let processingQueue = false;

async function initSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }, (response) => {
      if (response?.success) {
        resolve(response.data as UserSettings);
      } else {
        resolve({
          targetLanguage: "Bengali",
          difficulty: "intermediate",
          enabled: true,
          apiKey: "",
          displayMode: "tooltip",
          maxTranslationsPerPage: 50,
        });
      }
    });
  });
}

function createWordSpan(word: string, originalText: string, start: number, end: number, isInline: boolean): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-linguaflow", "word");
  span.setAttribute("data-lf-word", word);
  span.textContent = originalText.substring(start, end);

  if (isInline) {
    span.style.cssText = `
      cursor: pointer;
      border-bottom: 1px dotted #818cf8;
      transition: background 0.15s;
      position: relative;
    `;
  } else {
    span.style.cssText = `
      cursor: pointer;
      border-bottom: 2px dashed #818cf8;
      transition: background 0.15s;
      position: relative;
    `;
  }

  const state: WordState = {
    element: span,
    word,
    result: null,
    loading: false,
    error: null,
    saved: false,
  };
  wordStateMap.set(span, state);

  span.addEventListener("mouseenter", () => handleWordHover(span));
  span.addEventListener("mouseleave", () => hideTooltip());
  span.addEventListener("click", (e) => {
    if (state.result && !state.saved) {
      e.stopPropagation();
    }
  });

  return span;
}

async function handleWordHover(span: HTMLElement) {
  const state = wordStateMap.get(span);
  if (!state) return;

  if (state.result) {
    showTooltip(span, state.word, state.result, false, null, () => saveWord(state), state.saved);
    return;
  }

  if (state.loading) {
    showTooltip(span, state.word, null, true, null, () => {}, false);
    return;
  }

  state.loading = true;
  showTooltip(span, state.word, null, true, null, () => {}, false);

  try {
    const result = await translateWord(state.word);
    state.result = result;
    state.loading = false;
    state.error = null;
    showTooltip(span, state.word, result, false, null, () => saveWord(state), state.saved);
  } catch (err) {
    state.loading = false;
    state.error = err instanceof Error ? err.message : "Translation failed";
    showTooltip(span, state.word, null, false, state.error, () => {}, false);
  }
}

function translateWord(word: string): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MESSAGE_TYPES.TRANSLATE_WORD, payload: { word } },
      (response) => {
        if (response?.success) {
          resolve(response.data as TranslationResult);
        } else {
          reject(new Error(response?.error || "Translation failed"));
        }
      }
    );
  });
}

async function saveWord(state: WordState) {
  if (!state.result || !settings) return;

  const entry: VocabularyEntry = {
    id: generateVocabularyId(),
    word: state.word,
    translation: state.result.translation,
    definition: state.result.definition,
    pronunciation: state.result.pronunciation,
    synonym: state.result.synonym,
    context: state.element.parentElement?.textContent?.substring(0, 200) || "",
    sourceUrl: window.location.href,
    targetLanguage: settings.targetLanguage,
    savedAt: Date.now(),
    reviewCount: 0,
  };

  chrome.runtime.sendMessage(
    { type: MESSAGE_TYPES.SAVE_VOCABULARY, payload: entry },
    (response) => {
      if (response?.success) {
        state.saved = true;
        showTooltip(state.element, state.word, state.result, false, null, () => {}, true);
      }
    }
  );
}

async function fetchAndInline(span: HTMLElement, state: WordState) {
  try {
    const result = await translateWord(state.word);
    state.result = result;
    state.loading = false;

    if (!span.parentNode) return;

    const existingSuffix = span.nextSibling;
    if (existingSuffix && existingSuffix.nodeType === Node.TEXT_NODE &&
        existingSuffix.textContent?.startsWith(" (")) {
      existingSuffix.textContent = ` (${result.translation})`;
      return;
    }

    const suffix = document.createTextNode(` (${result.translation})`);
    if (span.nextSibling) {
      span.parentNode.insertBefore(suffix, span.nextSibling);
    } else {
      span.parentNode.appendChild(suffix);
    }
  } catch {
    state.loading = false;
  }
}

function processTextNode(textNode: Text) {
  if (!settings || !settings.enabled) return;
  if (translatedWords.size >= settings.maxTranslationsPerPage) return;

  const text = textNode.textContent || "";
  if (text.length < 4) return;

  const parent = textNode.parentElement;
  if (!parent || parent.hasAttribute("data-linguaflow")) return;

  const wordRegex = /\b[a-zA-Z]{3,}\b/g;
  const matches: Array<{ word: string; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[0];
    const lower = word.toLowerCase();

    if (shouldTranslate(lower, settings.difficulty) && !translatedWords.has(lower)) {
      matches.push({ word, index: match.index });
      translatedWords.add(lower);
    }
  }

  if (matches.length === 0) return;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  const isInline = settings.displayMode === "inline";

  const sorted = matches.sort((a, b) => a.index - b.index);
  for (const { word, index } of sorted) {
    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex, index)));
    }
    const span = createWordSpan(word, text, index, index + word.length, isInline);
    fragment.appendChild(span);

    if (isInline) {
      const state = wordStateMap.get(span);
      if (state) {
        state.loading = true;
        fetchAndInline(span, state);
      }
    }

    lastIndex = index + word.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  }

  parent.replaceChild(fragment, textNode);
}

function processVisibleContent() {
  if (!settings || !settings.enabled) return;

  const body = document.body;
  if (!body) return;

  let count = 0;
  const maxToProcess = settings.maxTranslationsPerPage - translatedWords.size;

  for (const textNode of walkTextNodes(body)) {
    if (count >= maxToProcess) break;
    const parent = textNode.parentElement;
    if (!parent || parent.hasAttribute("data-linguaflow")) continue;

    const rect = (parent as HTMLElement).getBoundingClientRect?.();
    if (rect && !isElementVisible(rect)) continue;

    processTextNode(textNode);
    count++;
  }
}

function isElementVisible(rect: DOMRect): boolean {
  return (
    rect.top < window.innerHeight + 500 &&
    rect.bottom > -500
  );
}

function scheduleScan(delay = 500) {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => {
    processVisibleContent();
  }, delay);
}

function handleMutations(mutations: MutationRecord[]) {
  scheduleScan(800);
}

async function init() {
  injectGlobalStyles();
  settings = await initSettings();

  if (!settings.enabled) return;

  processVisibleContent();
  observer = createObserver(handleMutations);

  let scrollTimeout: ReturnType<typeof setTimeout>;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => processVisibleContent(), 300);
  }, { passive: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.SETTINGS_UPDATED) {
      settings = message.payload as UserSettings;
      if (settings.enabled) {
        processVisibleContent();
      } else {
        removeAllTranslations();
      }
    }
  });
}

function removeAllTranslations() {
  const spans = document.querySelectorAll("[data-linguaflow=word]");
  spans.forEach((span) => {
    const next = span.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" (")) {
      next.remove();
    }
    const parent = span.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(span.textContent || ""), span);
    }
  });
  translatedWords.clear();
  const tip = document.getElementById("linguaflow-tooltip");
  if (tip) tip.remove();
}

function injectGlobalStyles() {
  if (document.getElementById("linguaflow-global-styles")) return;
  const style = document.createElement("style");
  style.id = "linguaflow-global-styles";
  style.textContent = `
    [data-linguaflow] {
      all: revert;
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
