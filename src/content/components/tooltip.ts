import { MESSAGE_TYPES } from "../../shared/constants";
import type { TranslationResult } from "../../shared/types";

const TOOLTIP_ID = "linguaflow-tooltip";
const TOOLTIP_STYLE_ID = "linguaflow-tooltip-styles";

const TOOLTIP_STYLES = `
#${TOOLTIP_ID} {
  position: fixed;
  z-index: 2147483647;
  max-width: 320px;
  min-width: 200px;
  background: var(--lf-bg, #ffffff);
  color: var(--lf-text, #1a1a2e);
  border: 1px solid var(--lf-border, #e2e8f0);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  padding: 14px 16px;
  pointer-events: auto;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
  backdrop-filter: blur(12px);
}

#${TOOLTIP_ID}.lf-visible {
  opacity: 1;
  transform: translateY(0);
}

#${TOOLTIP_ID}.lf-dark {
  --lf-bg: #1e1e2e;
  --lf-text: #e2e8f0;
  --lf-border: #2d2d44;
  --lf-accent: #818cf8;
  --lf-muted: #94a3b8;
  --lf-badge-bg: #2d2d44;
}

#${TOOLTIP_ID} .lf-word {
  font-size: 16px;
  font-weight: 600;
  color: var(--lf-accent, #4f46e5);
  margin-bottom: 6px;
}

#${TOOLTIP_ID} .lf-translation {
  font-size: 15px;
  font-weight: 500;
  color: var(--lf-text, #1a1a2e);
  margin-bottom: 4px;
}

#${TOOLTIP_ID} .lf-definition {
  font-size: 12px;
  color: var(--lf-muted, #64748b);
  margin-bottom: 8px;
  font-style: italic;
}

#${TOOLTIP_ID} .lf-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

#${TOOLTIP_ID} .lf-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 500;
  background: var(--lf-badge-bg, #f1f5f9);
  color: var(--lf-muted, #64748b);
}

#${TOOLTIP_ID} .lf-badge .lf-label {
  font-weight: 600;
  color: var(--lf-accent, #4f46e5);
}

#${TOOLTIP_ID} .lf-save-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: var(--lf-accent, #4f46e5);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

#${TOOLTIP_ID} .lf-save-btn:hover {
  background: var(--lf-accent-hover, #4338ca);
}

#${TOOLTIP_ID} .lf-save-btn.lf-saved {
  background: #22c55e;
}

#${TOOLTIP_ID} .lf-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--lf-muted, #64748b);
}

#${TOOLTIP_ID} .lf-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--lf-border, #e2e8f0);
  border-top-color: var(--lf-accent, #4f46e5);
  border-radius: 50%;
  animation: lf-spin 0.7s linear infinite;
}

@keyframes lf-spin {
  to { transform: rotate(360deg); }
}

#${TOOLTIP_ID} .lf-error {
  color: #ef4444;
  font-size: 12px;
}
`;

function injectStyles() {
  if (document.getElementById(TOOLTIP_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TOOLTIP_STYLE_ID;
  style.textContent = TOOLTIP_STYLES;
  document.head.appendChild(style);
}

function detectColorScheme(): boolean {
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  if (htmlBg) {
    const rgb = htmlBg.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
      return brightness < 128;
    }
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getTooltip(): HTMLElement {
  let tip = document.getElementById(TOOLTIP_ID);
  if (!tip) {
    injectStyles();
    tip = document.createElement("div");
    tip.id = TOOLTIP_ID;
    document.body.appendChild(tip);

    tip.addEventListener("mouseenter", () => {
      currentHovered = tip;
    });
    tip.addEventListener("mouseleave", () => {
      currentHovered = null;
      hideTooltip();
    });
  }
  return tip;
}

let currentWord: string | null = null;
let currentHovered: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

export function showTooltip(
  anchor: HTMLElement,
  word: string,
  result: TranslationResult | null,
  loading: boolean,
  error: string | null,
  onSave: () => void,
  saved: boolean
) {
  const tip = getTooltip();
  currentWord = word;

  const isDark = detectColorScheme();
  tip.classList.toggle("lf-dark", isDark);

  let html = `<div class="lf-word">${escapeHtml(word)}</div>`;

  if (loading) {
    html += `<div class="lf-loading"><div class="lf-spinner"></div> Translating...</div>`;
  } else if (error) {
    html += `<div class="lf-error">${escapeHtml(error)}</div>`;
  } else if (result) {
    if (result.translation) {
      html += `<div class="lf-translation">${escapeHtml(result.translation)}</div>`;
    }
    if (result.definition) {
      html += `<div class="lf-definition">${escapeHtml(result.definition)}</div>`;
    }
    const badges: string[] = [];
    if (result.pronunciation) {
      badges.push(`<span class="lf-badge"><span class="lf-label">🔊</span> ${escapeHtml(result.pronunciation)}</span>`);
    }
    if (result.synonym) {
      badges.push(`<span class="lf-badge"><span class="lf-label">≈</span> ${escapeHtml(result.synonym)}</span>`);
    }
    if (badges.length > 0) {
      html += `<div class="lf-meta">${badges.join("")}</div>`;
    }
    html += `<button class="lf-save-btn ${saved ? "lf-saved" : ""}" id="lf-save-btn">${saved ? "✓ Saved" : "+ Save"}</button>`;
  }

  tip.innerHTML = html;

  const saveBtn = tip.querySelector("#lf-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSave();
    });
  }

  positionTooltip(tip, anchor);
  tip.classList.add("lf-visible");
}

function positionTooltip(tip: HTMLElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const tipWidth = 320;
  const tipHeight = tip.offsetHeight || 120;
  const gap = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.left + rect.width / 2 - tipWidth / 2;
  let top = rect.bottom + gap;

  if (top + tipHeight > viewportHeight - 20) {
    top = rect.top - tipHeight - gap;
  }

  if (left < 10) left = 10;
  if (left + tipWidth > viewportWidth - 10) left = viewportWidth - tipWidth - 10;

  if (top < 10) top = 10;

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTooltip() {
  if (currentHovered === document.getElementById(TOOLTIP_ID)) return;

  hideTimeout = setTimeout(() => {
    const tip = document.getElementById(TOOLTIP_ID);
    if (tip && currentHovered !== tip) {
      tip.classList.remove("lf-visible");
      currentWord = null;
    }
  }, 200);
}

export function getCurrentWord(): string | null {
  return currentWord;
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
