import { MESSAGE_TYPES } from "../shared/constants";
import type { TranslationResult, UserSettings, VocabularyEntry } from "../shared/types";
import { shouldTranslate } from "../shared/wordlists";
import { collectTextNodes, isSkipNode } from "./utils/dom-scanner";
import { showTooltip } from "./components/tooltip";
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
let settings: UserSettings | null = null;
let observer: MutationObserver | null = null;
let isScanning = false;
let isActivated = false;

/* ── Settings ── */

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
    displayMode: "tooltip",
    maxTranslationsPerPage: 1000,
  };
}

/* ── Activation ── */

function activate() {
  if (isActivated) return;
  isActivated = true;
  console.log("[LinguaFlow] Activated on this page");
  processPageWords();

  observer = createSafeObserver(() => {
    if (isActivated) processPageWords();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function deactivate() {
  isActivated = false;
  removeAllTranslations();
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  console.log("[LinguaFlow] Deactivated on this page");
}

/* ── Word wrapping ── */

function createWordSpan(word: string, originalText: string, start: number, end: number): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-linguaflow", "word");
  span.setAttribute("data-lf-word", word);
  span.textContent = originalText.substring(start, end);
  span.style.cssText = `
    cursor: pointer;
    border-bottom: 1px dotted #818cf8;
    transition: background 0.15s;
    font-size: inherit;
    line-height: inherit;
  `;

  const state: WordState = {
    element: span,
    word,
    result: null,
    loading: false,
    error: null,
    saved: false,
  };
  wordStateMap.set(span, state);

  span.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    handleWordClick(span, state);
  });

  return span;
}

/* ── Click handler ── */

async function handleWordClick(span: HTMLElement, state: WordState) {
  if (state.loading) return;

  if (state.result) {
    showTooltip(span, state.word, state.result, false, null, () => saveWord(state), state.saved);
    return;
  }

  const context = span.parentElement?.textContent?.substring(0, 200) || "";

  state.loading = true;
  showTooltip(span, state.word, null, true, null, () => {}, false);

  try {
    const result = await translateWord(state.word, context);
    state.result = result;
    state.loading = false;
    state.error = null;

    if (settings?.displayMode === "inline" && result.translation) {
      insertInlineTranslation(span, result.translation);
    }

    showTooltip(span, state.word, result, false, null, () => saveWord(state), state.saved);
  } catch (err) {
    state.loading = false;
    state.error = err instanceof Error ? err.message : "Translation failed";
    showTooltip(span, state.word, null, false, state.error, () => {}, false);
  }
}

function insertInlineTranslation(span: HTMLElement, translation: string) {
  if (!span.parentNode) return;
  const existing = span.nextSibling;
  if (existing?.nodeType === Node.TEXT_NODE && existing.textContent?.startsWith(" (")) {
    existing.textContent = ` (${translation})`;
    return;
  }
  const suffix = document.createTextNode(` (${translation})`);
  if (span.nextSibling) {
    span.parentNode.insertBefore(suffix, span.nextSibling);
  } else {
    span.parentNode.appendChild(suffix);
  }
}

/* ── Translation ── */

function translateWord(word: string, context: string): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: MESSAGE_TYPES.TRANSLATE_WORD, payload: { word, context } },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve(response.data as TranslationResult);
          } else {
            reject(new Error(response?.error || "Translation failed"));
          }
        }
      );
    } catch {
      reject(new Error("Extension context lost"));
    }
  });
}

/* ── Vocabulary save ── */

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
      if (chrome.runtime.lastError) return;
      if (response?.success) {
        state.saved = true;
        showTooltip(state.element, state.word, state.result, false, null, () => {}, true);
      }
    }
  );
}

/* ── DOM processing ── */

function processTextNode(textNode: Text) {
  if (!settings || !settings.enabled) return;

  const text = textNode.textContent || "";
  if (text.length < 3) return;

  const parent = textNode.parentElement;
  if (!parent || parent.closest("[data-linguaflow]")) return;

  const wordRegex = /[a-zA-Z]{3,}/g;
  const matches: Array<{ word: string; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[0];
    const lower = word.toLowerCase();
    if (shouldTranslate(lower, settings.difficulty)) {
      matches.push({ word, index: match.index });
    }
  }

  if (matches.length === 0) return;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  const sorted = matches.sort((a, b) => a.index - b.index);
  for (const { word, index } of sorted) {
    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex, index)));
    }
    const span = createWordSpan(word, text, index, index + word.length);
    fragment.appendChild(span);
    lastIndex = index + word.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  }

  try {
    parent.replaceChild(fragment, textNode);
  } catch {
    // Node may have been removed by page JS
  }
}

function processPageWords() {
  if (!settings || !settings.enabled || !isActivated) return;
  if (isScanning) return;
  isScanning = true;

  try {
    const body = document.body;
    if (!body) return;

    const allNodes = collectTextNodes(body);
    const candidates: Text[] = [];

    for (const textNode of allNodes) {
      const parent = textNode.parentElement;
      if (!parent) continue;
      if (parent.closest("[data-linguaflow]")) continue;
      if (isSkipNode(parent)) continue;

      const text = textNode.textContent || "";
      if (text.trim().length < 3) continue;

      candidates.push(textNode);
      if (candidates.length >= settings.maxTranslationsPerPage) break;
    }

    if (candidates.length === 0) return;

    let wrappedCount = 0;
    for (const textNode of candidates) {
      const parent = textNode.parentElement;
      if (!parent || parent.closest("[data-linguaflow]")) continue;
      processTextNode(textNode);
      wrappedCount++;
    }

    if (wrappedCount > 0) {
      console.log(`[LinguaFlow] Wrapped ${wrappedCount} text nodes`);
      updateIndicator();
    }
  } finally {
    isScanning = false;
  }
}

/* ── Floating indicator ── */

function updateIndicator() {
  let badge = document.getElementById("linguaflow-indicator");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "linguaflow-indicator";
    badge.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #4f46e5;
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      cursor: default;
      user-select: none;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.3s, transform 0.3s;
    `;
    document.body.appendChild(badge);
    badge.offsetHeight;
    badge.style.opacity = "1";
    badge.style.transform = "translateY(0)";
  }
  const wordCount = document.querySelectorAll("[data-linguaflow=word]").length;
  badge.textContent = `LinguaFlow · ${wordCount} words ready · click to translate`;
}

function removeIndicator() {
  const badge = document.getElementById("linguaflow-indicator");
  if (badge) badge.remove();
}

/* ── Cleanup ── */

function removeAllTranslations() {
  const spans = document.querySelectorAll("[data-linguaflow=word]");
  spans.forEach((span) => {
    const next = span.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" (")) {
      next.remove();
    }
    const parent = span.parentNode;
    if (parent) parent.replaceChild(document.createTextNode(span.textContent || ""), span);
  });
  const tip = document.getElementById("linguaflow-tooltip");
  if (tip) tip.remove();
  removeIndicator();
}

/* ── MutationObserver that ignores our own mutations ── */

function createSafeObserver(callback: () => void): MutationObserver {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = (node as Text).parentElement;
          if (parent && parent.closest("[data-linguaflow]")) continue;
          if (node.textContent && node.textContent.trim().length >= 3) return true;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (el.id === "linguaflow-indicator") continue;
          if (el.id === "linguaflow-tooltip") continue;
          if (el.hasAttribute("data-linguaflow")) continue;
          if (el.closest("[data-linguaflow]")) continue;
          return true;
        }
      }
      for (const node of m.removedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = m.target as Element;
          if (parent && parent.closest("[data-linguaflow]")) continue;
          if (node.textContent && node.textContent.trim().length >= 3) return true;
        }
      }
      return false;
    });

    if (relevant) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(callback, 800);
    }
  });
}

/* ── Message handler (registered at top level so it's ready immediately) ── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case MESSAGE_TYPES.GET_PAGE_STATUS:
      sendResponse({ success: true, data: { activated: isActivated } });
      return false;

    case MESSAGE_TYPES.ACTIVATE_PAGE:
      handleActivate().then(() => {
        sendResponse({ success: true, data: { activated: true } });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;

    case MESSAGE_TYPES.DEACTIVATE_PAGE:
      deactivate();
      sendResponse({ success: true, data: { activated: false } });
      return false;

    case MESSAGE_TYPES.RESCAN_PAGE:
      if (isActivated) {
        removeAllTranslations();
        processPageWords();
      }
      sendResponse({ success: true });
      return false;

    case MESSAGE_TYPES.SETTINGS_UPDATED:
      if (message.payload) {
        settings = message.payload as UserSettings;
        if (!settings.enabled) deactivate();
      }
      sendResponse({ success: true });
      return false;
  }
});

async function handleActivate() {
  if (!settings) {
    console.log("[LinguaFlow] Loading settings before activating...");
    settings = await initSettings();
  }
  if (!settings.enabled) {
    throw new Error("Extension is disabled globally. Enable it via the toggle in the popup.");
  }
  console.log(`[LinguaFlow] Activating — ${settings.targetLanguage} / ${settings.difficulty} / ${settings.displayMode}`);
  activate();
}

/* ── Init ── */

async function init() {
  settings = await initSettings();

  if (!settings.enabled) {
    console.log("[LinguaFlow] Extension disabled globally");
    return;
  }

  console.log(`[LinguaFlow] Auto-activating — ${settings.targetLanguage} / ${settings.difficulty}`);
  activate();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
