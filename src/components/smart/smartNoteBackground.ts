const containers = new Set(["DIV", "MAIN", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "NAV", "FORM"]);

function transparent(color: string) {
  return !color || color === "transparent" || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color) || /\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
}

/** Read only the outer page surface, never a background from an inner control. */
export function smartNoteBackground(root: HTMLElement): string | null {
  let surface = root;
  while (true) {
    const style = getComputedStyle(surface);
    if (style.display !== "contents" && !transparent(style.backgroundColor)) return style.backgroundColor;
    // Metadata and non-rendered siblings do not split the outer wrapper chain.
    // Text does: a wrapper beside visible text is no longer the page surface.
    if ([...surface.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return null;
    const children = [...surface.children].filter(child => !child.matches("style, link, script, template, [hidden]") && getComputedStyle(child).display !== "none");
    if (children.length !== 1 || !(children[0] instanceof HTMLElement) || !containers.has(children[0].tagName)) return null;
    surface = children[0];
  }
}
