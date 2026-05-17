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

export function* walkTextNodes(root: Node): Generator<Text> {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node: Node) => {
        const text = node.textContent;
        if (!text || text.trim().length < 3) {
          return NodeFilter.FILTER_SKIP;
        }

        let parent: Element | null = node.parentElement;
        while (parent && parent !== root) {
          if (isSkipNode(parent)) {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    yield node as Text;
  }
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

export function isInsideSkipElement(node: Node): boolean {
  let parent: Element | null = node.parentElement;
  while (parent) {
    if (isSkipNode(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}