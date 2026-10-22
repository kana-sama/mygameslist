interface Stylesheet {
  href: string;
  loaded: boolean;
  dispose(): void;
}

/** Observe the program's styles as well as styles in nested open shadows. */
export function observeSmartNoteStyles(root: HTMLElement, change: (pending: boolean) => void, fail: (reason: Error) => void) {
  const links = new Map<HTMLLinkElement, Stylesheet>();
  const roots = new Map<HTMLElement | ShadowRoot, MutationObserver>();
  let disposed = false;

  const scan = () => {
    if (disposed) return;
    const currentLinks = new Set<HTMLLinkElement>();
    const currentRoots = new Set<HTMLElement | ShadowRoot>();
    const visit = (tree: HTMLElement | ShadowRoot) => {
      currentRoots.add(tree);
      if (tree instanceof HTMLElement && tree.shadowRoot) visit(tree.shadowRoot);
      for (const element of tree.querySelectorAll("*")) {
        if (element instanceof HTMLLinkElement && element.rel.toLowerCase().split(/\s+/).includes("stylesheet") && element.getAttribute("href") && !element.disabled) currentLinks.add(element);
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(root);
    for (const [tree, observer] of roots) {
      if (!currentRoots.has(tree)) { observer.disconnect(); roots.delete(tree); }
    }
    for (const tree of currentRoots) {
      if (roots.has(tree)) continue;
      const observer = new MutationObserver(scan);
      observer.observe(tree, { subtree: true, childList: true, attributes: true, attributeFilter: ["href", "rel", "disabled"] });
      roots.set(tree, observer);
    }
    for (const [link, state] of links) {
      if (!currentLinks.has(link) || state.href !== link.href) { state.dispose(); links.delete(link); }
    }
    for (const link of currentLinks) {
      if (links.has(link)) continue;
      const href = link.href;
      const state: Stylesheet = { href, loaded: Boolean(link.sheet), dispose: () => { link.removeEventListener("load", load); link.removeEventListener("error", error); } };
      const load = () => {
        scan();
        if (disposed || links.get(link) !== state) return;
        state.loaded = true; publish();
      };
      const error = () => {
        scan();
        if (!disposed && links.get(link) === state) fail(new Error(`Не удалось загрузить стили заметки: ${href}`));
      };
      link.addEventListener("load", load); link.addEventListener("error", error);
      links.set(link, state);
    }
    publish();
  };
  const publish = () => change([...links.values()].some(state => !state.loaded));
  scan();
  return { refresh: scan, dispose() {
    if (disposed) return;
    disposed = true;
    for (const observer of roots.values()) observer.disconnect();
    for (const state of links.values()) state.dispose();
    roots.clear(); links.clear();
  } };
}
