import { MESSAGE_TYPES } from "../shared/constants";
import type { TranslationResult, UserSettings, VocabularyEntry } from "../shared/types";
import { shouldTranslate } from "../shared/wordlists";
import { collectTextNodes, createObserver, isSkipNode } from "./utils/dom-scanner";
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
let scanTimeout: ReturnType<typeof setTimeout> | null = null;

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
      console.log("[LinguaFlow] Settings loaded:", result.targetLanguage, result.difficulty, result.displayMode);
      return result;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  console.warn("[LinguaFlow] Using default settings — background unreachable");
  return {
    targetLanguage: "Bengali",
    difficulty: "intermediate",
    enabled: true,
    apiKey: "",
    displayMode: "tooltip",
    maxTranslationsPerPage: 200,
  };
}

/* ── Word wrapping ── */

function createWordSpan(word: string, originalText: string, start: number, end: number): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-linguaflow", "word");
  span.setAttribute("data-lf-word", word);
  span.textContent = originalText.substring(start, end);
  // NOTE: we do NOT set all: revert — it breaks dark-mode blogs by forcing black text
  span.style.cssText = `
    cursor: pointer;
    border-bottom: 1px dotted #818cf8;
    transition: background 0.15s;
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

  state.loading = true;
  showTooltip(span, state.word, null, true, null, () => {}, false);

  try {
    const result = await translateWord(state.word);
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

function translateWord(word: string): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: MESSAGE_TYPES.TRANSLATE_WORD, payload: { word } },
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
  if (!parent || parent.hasAttribute("data-linguaflow")) return;

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
  if (!settings || !settings.enabled) return;

  const body = document.body;
  if (!body) return;

  // STEP 1: Collect ALL text nodes first (don't modify DOM yet)
  const allNodes = collectTextNodes(body);
  console.log(`[LinguaFlow] Collected ${allNodes.length} text nodes`);

  // STEP 2: Filter to visible, non-skip nodes
  const candidates: Text[] = [];
  for (const textNode of allNodes) {
    const parent = textNode.parentElement;
    if (!parent) continue;
    if (parent.hasAttribute("data-linguaflow")) continue;
    if (isSkipNode(parent)) continue;

    const rect = (parent as HTMLElement).getBoundingClientRect?.();
    if (rect) {
      const visible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
      if (!visible) continue;
    }

    const text = textNode.textContent || "";
    if (text.trim().length < 3) continue;

    candidates.push(textNode);
    if (candidates.length >= settings.maxTranslationsPerPage) break;
  }

  console.log(`[LinguaFlow] ${candidates.length} candidate text nodes to process`);

  // STEP 3: Process each text node (now safe to modify DOM)
  let wrappedCount = 0;
  for (const textNode of candidates) {
    const parent = textNode.parentElement;
    if (!parent || parent.hasAttribute("data-linguaflow")) continue;
    processTextNode(textNode);
    wrappedCount++;
  }

  console.log(`[LinguaFlow] Wrapped words in ${wrappedCount} text nodes`);
  updateIndicator(wrappedCount);
}

/* ── Floating indicator ── */

function updateIndicator(wrappedCount: number) {
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
    // Force reflow
    badge.offsetHeight;
    badge.style.opacity = "1";
    badge.style.transform = "translateY(0)";
  }
  badge.textContent = `LinguaFlow · ${wrappedCount} words ready · click to translate`;
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

/* ── Init ── */

async function init() {
  settings = await initSettings();

  if (!settings.enabled) {
    console.log("[LinguaFlow] Extension disabled");
    return;
  }

  console.log(`[LinguaFlow] Starting scan… mode=${settings.displayMode} lang=${settings.targetLanguage}`);

  setTimeout(() => {
    processPageWords();
    observer = createObserver(() => {
      console.log("[LinguaFlow] DOM changed, rescanning…");
      processPageWords();
    });
  }, 400);

  window.addEventListener("scroll", () => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(processPageWords, 400);
  }, { passive: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.SETTINGS_UPDATED) {
      settings = message.payload as UserSettings;
      if (!settings.enabled) removeAllTranslations();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
