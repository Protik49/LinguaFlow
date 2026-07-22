import { SKIP_TAGS, SKIP_CLASSES, SKIP_ATTRS } from "../../shared/constants";

export function isSkipNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;

  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute("contenteditable")) return true;
  if (el.closest("[contenteditable]")) return true;

  if (el.closest("nav, footer, button")) {
    return true;
  }

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

export function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}
