import { SKIP_TAGS, SKIP_CLASSES, SKIP_ATTRS } from "../../shared/constants";

export function isSkipNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;

  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute("contenteditable")) return true;
  if (el.closest("[contenteditable]")) return true;

  for (const cls of SKIP_CLASSES) {
    if (el.className && typeof el.className === "string" && el.classList.contains(cls)) {
      return true;
    }
  }

  for (const attr of SKIP_ATTRS) {
    if (el.hasAttribute(attr)) return true;
  }

  if (el.hasAttribute("data-linguaflow")) return true;

  const role = el.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;

  if (el.shadowRoot) return true;

  return false;
}

/**
 * Collect all text nodes from the DOM.
 * We do NOT use a TreeWalker filter callback because:
 * 1. Arrow functions in filter callbacks break in Safari
 * 2. Modifying DOM during iteration corrupts the walker
 * Instead we collect ALL text nodes first, then filter manually.
 */
export function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}

export function createObserver(callback: () => void): MutationObserver {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      if (m.type === "childList") {
        return Array.from(m.addedNodes).some((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length >= 3) {
            return true;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            return !isSkipNode(el) && !el.hasAttribute("data-linguaflow");
          }
          return false;
        });
      }
      if (m.type === "characterData") {
        const parent = m.target.parentElement;
        return parent ? !isSkipNode(parent) : false;
      }
      return false;
    });

    if (relevant) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(callback, 600);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return observer;
}
