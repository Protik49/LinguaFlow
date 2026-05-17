import { SKIP_TAGS, SKIP_CLASSES, SKIP_ATTRS } from "../../shared/constants";

export function isSkipNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;

  if (SKIP_TAGS.has(el.tagName)) return true;

  if (el.hasAttribute("contenteditable")) return true;

  if (el.closest("[contenteditable=true]")) return true;

  for (const cls of SKIP_CLASSES) {
    if (
      el.className &&
      typeof el.className === "string" &&
      el.className.toLowerCase().includes(cls.toLowerCase())
    ) {
      return true;
    }
  }

  for (const attr of SKIP_ATTRS) {
    if (el.hasAttribute(attr)) return true;
  }

  if (el.hasAttribute("data-linguaflow")) return true;

  const role = el.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;

  return false;
}

export function* walkTextNodes(root: Node): Generator<Text> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text) {
      if (!node.textContent || !node.textContent.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      let parent: Node | null = node.parentElement;
      while (parent && parent !== root) {
        if (parent.nodeType === Node.ELEMENT_NODE && isSkipNode(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        parent = parent.parentNode;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    yield node;
  }
}

export function getTextNodesInElement(element: Element): Text[] {
  const nodes: Text[] = [];
  for (const node of walkTextNodes(element)) {
    nodes.push(node);
  }
  return nodes;
}

export function getSentenceContext(textNode: Text, wordStart: number, wordEnd: number): string {
  const fullText = textNode.textContent || "";
  const sentenceStart = Math.max(0, fullText.lastIndexOf(".", wordStart) + 1,
    fullText.lastIndexOf("!", wordStart) + 1,
    fullText.lastIndexOf("?", wordStart) + 1);
  const sentenceEnd = Math.min(
    fullText.length,
    ...[fullText.indexOf(".", wordEnd), fullText.indexOf("!", wordEnd), fullText.indexOf("?", wordEnd)]
      .filter((i) => i !== -1)
  );

  let start = sentenceStart === 0 ? 0 : sentenceStart;
  let end = sentenceEnd === fullText.length ? fullText.length : sentenceEnd + 1;

  if (end - start > 200) {
    const mid = (wordStart + wordEnd) / 2;
    start = Math.max(0, mid - 100);
    end = Math.min(fullText.length, mid + 100);
  }

  return fullText.substring(start, end).trim();
}

export function createObserver(callback: (mutations: MutationRecord[]) => void): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.filter((m) => {
      if (m.type === "childList") {
        return Array.from(m.addedNodes).some((node) => {
          if (node.nodeType === Node.TEXT_NODE) return true;
          if (node.nodeType === Node.ELEMENT_NODE) {
            return !isSkipNode(node) && !(node as Element).hasAttribute("data-linguaflow");
          }
          return false;
        });
      }
      if (m.type === "characterData") {
        return !isSkipNode(m.target.parentElement!);
      }
      return false;
    });

    if (relevant.length > 0) {
      callback(relevant);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: false,
  });

  return observer;
}
