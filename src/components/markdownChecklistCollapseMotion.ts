import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export const CHECKLIST_COLLAPSE_MOTION_DURATION_MS = 235;
export const CHECKLIST_COLLAPSE_MOTION_STAGGER_MS = 14;
export const CHECKLIST_COLLAPSE_MOTION_MAX_STAGGER_MS = 42;

interface MotionRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface MotionLayoutEntry {
  ancestorKeys: readonly string[];
  collapsedState: boolean;
  element: HTMLElement;
  key: string;
  listContainerTag: "ol" | "ul" | null;
  owner: string | null;
  rect: MotionRect;
  replicaContainer: Element;
  replicaRect: MotionRect;
  tableColumnWidths: readonly number[] | null;
  tableRow: boolean;
}

interface ExitClip {
  element: HTMLElement;
  top: number;
}

interface MotionTrigger {
  expanded: boolean;
  rect: MotionRect;
}

interface MotionLayout {
  entries: Map<string, MotionLayoutEntry>;
  triggers: Map<string, MotionTrigger>;
}

const MOTION_KEY_ATTRIBUTE = "data-checklist-collapse-motion-key";
const MOTION_OWNER_ATTRIBUTE = "data-checklist-collapse-motion-owner";
const MOTION_TRIGGER_ATTRIBUTE = "data-checklist-collapse-motion-trigger";
const REPLICA_CLASS_NAME = "markdown-checklist-collapse-motion-replica";
const COLLAPSE_ITEM_DURATION_MS = 185;
const EXPAND_ITEM_DURATION_MS = 190;
const COLLAPSE_OPACITY_DELAY_MS = 55;
const COLLAPSE_OPACITY_DURATION_MS = 85;
const EXPAND_OPACITY_DELAY_MS = 45;
const EXPAND_OPACITY_DURATION_MS = 95;
const SETTLE_DURATION_MS = 225;
const COLLAPSED_STATE_DURATION_MS = 145;
const COLLAPSED_STATE_DELAY_MS = 90;
const COLLAPSED_STATE_OPACITY_DURATION_MS = 85;
const COLLAPSED_STATE_OPACITY_DELAY_MS = 115;
const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const EXPAND_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const CLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const COLLAPSED_STATE_EASING = "cubic-bezier(0, 0, 0.2, 1)";

function rootLocalRect(rect: DOMRect, rootRect: DOMRect): MotionRect {
  return {
    height: rect.height,
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
  };
}

function elementIsVisibleParticipant(element: HTMLElement): boolean {
  return !element.closest(`.${REPLICA_CLASS_NAME}`) && !element.closest("[hidden]");
}

function collectMotionLayout(root: HTMLDivElement, portalRoot: Element | null): MotionLayout {
  const participantRoots = portalRoot && portalRoot !== root && !root.contains(portalRoot)
    ? [portalRoot, root]
    : [root];
  const entryElements = participantRoots.flatMap((container) =>
    [...container.querySelectorAll<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`)]
      .filter(elementIsVisibleParticipant)
      .map((element) => ({ container, element })),
  );
  const triggerElements = participantRoots.flatMap((container) =>
    [...container.querySelectorAll<HTMLElement>(`[${MOTION_TRIGGER_ATTRIBUTE}]`)]
      .filter(elementIsVisibleParticipant),
  );
  if (!entryElements.length && !triggerElements.length) return { entries: new Map(), triggers: new Map() };
  const rootRect = root.getBoundingClientRect();
  const entries = new Map<string, MotionLayoutEntry>();
  for (const { container, element } of entryElements) {
    const key = element.getAttribute(MOTION_KEY_ATTRIBUTE);
    if (!key || entries.has(key)) continue;
    const ancestorKeys: string[] = [];
    let ancestor = element.parentElement?.closest<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`) ?? null;
    while (ancestor && container.contains(ancestor)) {
      const ancestorKey = ancestor.getAttribute(MOTION_KEY_ATTRIBUTE);
      if (ancestorKey) ancestorKeys.push(ancestorKey);
      ancestor = ancestor.parentElement?.closest<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`) ?? null;
    }
    const listContainerTag = element.tagName === "LI" && element.parentElement?.tagName === "OL"
      ? "ol"
      : element.tagName === "LI" && element.parentElement?.tagName === "UL" ? "ul" : null;
    const tableRow = element.tagName === "TR";
    const elementRect = element.getBoundingClientRect();
    const containerRect = container === root ? rootRect : container.getBoundingClientRect();
    entries.set(key, {
      ancestorKeys,
      collapsedState: element.classList.contains("markdown-checklist-heading__collapsed-state"),
      element,
      key,
      listContainerTag,
      owner: element.getAttribute(MOTION_OWNER_ATTRIBUTE),
      rect: rootLocalRect(elementRect, rootRect),
      replicaContainer: container,
      replicaRect: rootLocalRect(elementRect, containerRect),
      tableColumnWidths: tableRow
        ? [...element.children].map((cell) => cell.getBoundingClientRect().width)
        : null,
      tableRow,
    });
  }
  const triggers = new Map<string, MotionTrigger>();
  for (const element of triggerElements) {
    const owner = element.getAttribute(MOTION_TRIGGER_ATTRIBUTE);
    if (!owner || triggers.has(owner)) continue;
    triggers.set(owner, {
      expanded: element.getAttribute("aria-expanded") !== "false",
      rect: rootLocalRect(element.getBoundingClientRect(), rootRect),
    });
  }
  return { entries, triggers };
}

function topLevelEntries(layout: MotionLayout, keys: ReadonlySet<string>): MotionLayoutEntry[] {
  return [...keys].flatMap((key) => {
    const entry = layout.entries.get(key);
    return entry && !entry.ancestorKeys.some((ancestorKey) => keys.has(ancestorKey)) ? [entry] : [];
  });
}

function stripCloneIds(element: HTMLElement): void {
  element.removeAttribute("id");
  for (const descendant of element.querySelectorAll<HTMLElement>("[id]")) descendant.removeAttribute("id");
}

function copyMotionRouting(source: MotionLayoutEntry, target: HTMLElement): void {
  target.setAttribute(MOTION_KEY_ATTRIBUTE, source.key);
  if (source.owner) target.setAttribute(MOTION_OWNER_ATTRIBUTE, source.owner);
}

function createListReplica(entry: MotionLayoutEntry, content: HTMLElement): HTMLElement {
  const shell = document.createElement(entry.listContainerTag!);
  copyMotionRouting(entry, shell);
  const sourceList = entry.element.parentElement!;
  shell.className = sourceList.className;
  shell.style.listStylePosition = getComputedStyle(sourceList).listStylePosition;
  if (shell instanceof HTMLOListElement && sourceList instanceof HTMLOListElement) {
    const sourceItems = [...sourceList.children].filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
    const step = sourceList.reversed ? -1 : 1;
    let ordinal = sourceList.hasAttribute("start") ? sourceList.start : sourceList.reversed ? sourceItems.length : 1;
    for (const sourceItem of sourceItems) {
      if (sourceItem.hasAttribute("value")) ordinal = sourceItem.value;
      if (sourceItem === entry.element) break;
      ordinal += step;
    }
    shell.start = ordinal;
    shell.type = sourceList.type;
    shell.reversed = sourceList.reversed;
  }
  shell.style.margin = "0";
  shell.style.padding = "0";
  shell.append(content);
  return shell;
}

function createTableReplica(entry: MotionLayoutEntry, content: HTMLElement): HTMLElement {
  const table = document.createElement("table");
  copyMotionRouting(entry, table);
  table.className = "markdown-table";
  if (entry.tableColumnWidths?.length) {
    const colgroup = document.createElement("colgroup");
    for (const width of entry.tableColumnWidths) {
      const column = document.createElement("col");
      column.style.width = `${width}px`;
      colgroup.append(column);
    }
    table.append(colgroup);
  }
  const body = document.createElement("tbody");
  body.append(content);
  table.append(body);
  return table;
}

function createExitReplica(entry: MotionLayoutEntry): HTMLElement {
  const content = entry.element.cloneNode(true) as HTMLElement;
  const replica = entry.listContainerTag
    ? createListReplica(entry, content)
    : entry.tableRow ? createTableReplica(entry, content) : content;
  stripCloneIds(replica);
  replica.classList.add(REPLICA_CLASS_NAME);
  replica.setAttribute("aria-hidden", "true");
  replica.setAttribute("inert", "");
  replica.style.height = `${entry.replicaRect.height}px`;
  replica.style.left = `${entry.replicaRect.left}px`;
  replica.style.margin = "0";
  replica.style.pointerEvents = "none";
  replica.style.top = `${entry.replicaRect.top}px`;
  replica.style.transformOrigin = "top left";
  replica.style.width = `${entry.replicaRect.width}px`;
  if (entry.tableRow) {
    replica.style.maxWidth = `${entry.replicaRect.width}px`;
    replica.style.minWidth = `${entry.replicaRect.width}px`;
  }
  return replica;
}

function ownerCenterDelta(entry: MotionLayoutEntry, owner: MotionRect): number {
  return owner.top + owner.height / 2 - (entry.rect.top + entry.rect.height / 2);
}

function cascadeDelay(index: number): number {
  return Math.min(index * CHECKLIST_COLLAPSE_MOTION_STAGGER_MS, CHECKLIST_COLLAPSE_MOTION_MAX_STAGGER_MS);
}

export function useMarkdownChecklistCollapseMotion(
  root: RefObject<HTMLDivElement | null>,
  collapsedIdsFingerprint: string,
  contentFingerprint: string,
  portalRoot: Element | null = null,
): void {
  const previousLayout = useRef<MotionLayout | null>(null);
  const previousFingerprint = useRef<string | null>(null);
  const previousContentFingerprint = useRef<string | null>(null);
  const activeAnimations = useRef(new Set<Animation>());
  const activeClips = useRef(new Set<HTMLElement>());
  const activeReplicas = useRef(new Set<HTMLElement>());

  const clearVisuals = (): void => {
    for (const animation of [...activeAnimations.current]) animation.cancel();
    activeAnimations.current.clear();
    for (const replica of activeReplicas.current) replica.remove();
    activeReplicas.current.clear();
    for (const clip of activeClips.current) clip.remove();
    activeClips.current.clear();
  };

  useLayoutEffect(() => {
    const rootElement = root.current;
    const transitionChanged = previousFingerprint.current !== null
      && previousFingerprint.current !== collapsedIdsFingerprint;
    const contentChanged = previousContentFingerprint.current !== null
      && previousContentFingerprint.current !== contentFingerprint;
    if (!rootElement) {
      if (transitionChanged || contentChanged) clearVisuals();
      previousLayout.current = null;
      previousFingerprint.current = collapsedIdsFingerprint;
      previousContentFingerprint.current = contentFingerprint;
      return;
    }
    if (!transitionChanged) {
      previousFingerprint.current = collapsedIdsFingerprint;
      previousContentFingerprint.current = contentFingerprint;
      if (contentChanged) clearVisuals();
      else if (activeAnimations.current.size || activeReplicas.current.size) return;
      previousLayout.current = collectMotionLayout(rootElement, portalRoot);
      return;
    }

    const priorLayout = previousLayout.current;
    clearVisuals();
    const nextLayout = collectMotionLayout(rootElement, portalRoot);
    previousLayout.current = nextLayout;
    previousFingerprint.current = collapsedIdsFingerprint;
    previousContentFingerprint.current = contentFingerprint;
    if (
      !priorLayout
      // Renderer keys may include source positions, so only compare layouts from identical Markdown content.
      || contentChanged
      || typeof Element.prototype.animate !== "function"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) return;

    const trackAnimation = (
      element: HTMLElement,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
      onSettled?: () => void,
    ): void => {
      let animation: Animation;
      try {
        animation = element.animate(keyframes, options);
      } catch {
        onSettled?.();
        return;
      }
      activeAnimations.current.add(animation);
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        activeAnimations.current.delete(animation);
        onSettled?.();
      };
      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
    };

    const animateExit = (
      entry: MotionLayoutEntry,
      owner: MotionRect,
      delay: number,
      clip: ExitClip | null,
      collapsedState = false,
      onSettled?: () => void,
    ): void => {
      const replica = createExitReplica(entry);
      if (clip) replica.style.top = `${entry.replicaRect.top - clip.top}px`;
      (clip?.element ?? entry.replicaContainer).append(replica);
      activeReplicas.current.add(replica);
      let remainingAnimations = 2;
      const animationSettled = () => {
        remainingAnimations -= 1;
        if (remainingAnimations > 0) return;
        activeReplicas.current.delete(replica);
        replica.remove();
        onSettled?.();
      };
      trackAnimation(replica, [
        { transform: "translateY(0px) scaleY(1)", transformOrigin: "top left" },
        { transform: `translateY(${ownerCenterDelta(entry, owner)}px) scaleY(0.08)`, transformOrigin: "top left" },
      ], {
        delay,
        duration: collapsedState ? COLLAPSED_STATE_DURATION_MS : COLLAPSE_ITEM_DURATION_MS,
        easing: collapsedState ? COLLAPSED_STATE_EASING : COLLAPSE_EASING,
        fill: "forwards",
      }, animationSettled);
      trackAnimation(replica, [
        { opacity: 1 },
        { opacity: 0 },
      ], {
        delay: collapsedState ? delay : delay + COLLAPSE_OPACITY_DELAY_MS,
        duration: collapsedState ? COLLAPSED_STATE_OPACITY_DURATION_MS : COLLAPSE_OPACITY_DURATION_MS,
        easing: collapsedState ? "ease-out" : "ease-in",
        fill: "forwards",
      }, animationSettled);
    };

    const createExitClip = (owner: MotionRect, entries: readonly MotionLayoutEntry[]): ExitClip | null => {
      const firstEntry = entries[0];
      if (!firstEntry) return null;
      const containerTopInRoot = firstEntry.rect.top - firstEntry.replicaRect.top;
      const top = owner.top + owner.height - containerTopInRoot;
      const height = Math.max(...entries.map((entry) => entry.replicaRect.top + entry.replicaRect.height - top));
      if (height <= 0) return null;
      const clip = document.createElement("div");
      clip.className = "markdown-checklist-collapse-motion-clip";
      clip.style.height = `${height}px`;
      clip.style.left = "0";
      clip.style.overflow = "hidden";
      clip.style.pointerEvents = "none";
      clip.style.position = "absolute";
      clip.style.top = `${top}px`;
      clip.style.width = "100%";
      firstEntry.replicaContainer.append(clip);
      activeClips.current.add(clip);
      return { element: clip, top };
    };

    const animateClip = (clip: ExitClip, height: number, onSettled: () => void): void => {
      trackAnimation(clip.element, [
        { height: `${height}px` },
        { height: "0px" },
      ], {
        duration: SETTLE_DURATION_MS,
        easing: CLIP_EASING,
        fill: "forwards",
      }, onSettled);
    };

    const disappearedKeys = new Set([...priorLayout.entries.keys()].filter((key) => !nextLayout.entries.has(key)));
    const disappearedEntries = topLevelEntries(priorLayout, disappearedKeys);
    const collapsedStateExits = disappearedEntries.filter((entry) => entry.collapsedState);
    const regularExits = disappearedEntries.filter((entry) => !entry.collapsedState && entry.owner);
    const exitsByOwner = new Map<string, MotionLayoutEntry[]>();
    for (const entry of regularExits) {
      const entries = exitsByOwner.get(entry.owner!) ?? [];
      entries.push(entry);
      exitsByOwner.set(entry.owner!, entries);
    }
    for (const [ownerId, entries] of exitsByOwner) {
      const owner = nextLayout.triggers.get(ownerId)?.rect ?? priorLayout.triggers.get(ownerId)?.rect;
      if (!owner) continue;
      entries.sort((left, right) => left.rect.top - right.rect.top);
      const entriesByContainer = new Map<Element, MotionLayoutEntry[]>();
      for (const entry of entries) {
        const containerEntries = entriesByContainer.get(entry.replicaContainer) ?? [];
        containerEntries.push(entry);
        entriesByContainer.set(entry.replicaContainer, containerEntries);
      }
      const clips = new Map<MotionLayoutEntry, { clip: ExitClip; release: () => void }>();
      for (const containerEntries of entriesByContainer.values()) {
        const clip = createExitClip(owner, containerEntries);
        if (!clip) continue;
        let remainingSettles = containerEntries.length + 1;
        const settled = () => {
          remainingSettles -= 1;
          if (remainingSettles > 0) return;
          activeClips.current.delete(clip.element);
          clip.element.remove();
        };
        const height = Number.parseFloat(clip.element.style.height);
        animateClip(clip, height, settled);
        for (const entry of containerEntries) clips.set(entry, { clip, release: settled });
      }
      entries.forEach((entry, index) => {
        const clipping = clips.get(entry);
        animateExit(entry, owner, cascadeDelay(entries.length - index - 1), clipping?.clip ?? null, false, clipping?.release);
      });
    }
    for (const entry of collapsedStateExits) {
      if (!entry.owner) continue;
      const owner = nextLayout.triggers.get(entry.owner)?.rect ?? priorLayout.triggers.get(entry.owner)?.rect;
      if (owner) animateExit(entry, owner, 0, null, true);
    }

    const appearedKeys = new Set([...nextLayout.entries.keys()].filter((key) => !priorLayout.entries.has(key)));
    const appearedEntries = topLevelEntries(nextLayout, appearedKeys);
    const collapsedStateEntries = appearedEntries.filter((entry) => entry.collapsedState);
    const regularEntries = appearedEntries.filter((entry) => !entry.collapsedState && entry.owner);
    const entriesByOwner = new Map<string, MotionLayoutEntry[]>();
    for (const entry of regularEntries) {
      const entries = entriesByOwner.get(entry.owner!) ?? [];
      entries.push(entry);
      entriesByOwner.set(entry.owner!, entries);
    }
    for (const [ownerId, entries] of entriesByOwner) {
      const owner = priorLayout.triggers.get(ownerId)?.rect ?? nextLayout.triggers.get(ownerId)?.rect;
      if (!owner) continue;
      entries.sort((left, right) => left.rect.top - right.rect.top);
      entries.forEach((entry, index) => {
        const delay = cascadeDelay(index);
        trackAnimation(entry.element, [
          { transform: `translateY(${ownerCenterDelta(entry, owner)}px) scaleY(0.08)`, transformOrigin: "top left" },
          { transform: "translateY(0px) scaleY(1)", transformOrigin: "top left" },
        ], {
          delay,
          duration: EXPAND_ITEM_DURATION_MS,
          easing: EXPAND_EASING,
          fill: "backwards",
        });
        trackAnimation(entry.element, [
          { opacity: 0 },
          { opacity: 1 },
        ], {
          delay: delay + EXPAND_OPACITY_DELAY_MS,
          duration: EXPAND_OPACITY_DURATION_MS,
          easing: "ease-out",
          fill: "backwards",
        });
      });
    }
    for (const entry of collapsedStateEntries) {
      if (!entry.owner) continue;
      const owner = priorLayout.triggers.get(entry.owner)?.rect ?? nextLayout.triggers.get(entry.owner)?.rect;
      if (!owner) continue;
      trackAnimation(entry.element, [
        { transform: `translateY(${ownerCenterDelta(entry, owner)}px) scaleY(0.08)`, transformOrigin: "top left" },
        { transform: "translateY(0px) scaleY(1)", transformOrigin: "top left" },
      ], {
        delay: COLLAPSED_STATE_DELAY_MS,
        duration: COLLAPSED_STATE_DURATION_MS,
        easing: COLLAPSED_STATE_EASING,
        fill: "backwards",
      });
      trackAnimation(entry.element, [
        { opacity: 0 },
        { opacity: 1 },
      ], {
        delay: COLLAPSED_STATE_OPACITY_DELAY_MS,
        duration: COLLAPSED_STATE_OPACITY_DURATION_MS,
        easing: "ease-out",
        fill: "backwards",
      });
    }

    const rawDeltas = new Map<string, number>();
    for (const [key, entry] of nextLayout.entries) {
      const priorEntry = priorLayout.entries.get(key);
      const rawDelta = priorEntry ? priorEntry.rect.top - entry.rect.top : 0;
      if (rawDelta !== 0) rawDeltas.set(key, rawDelta);
    }
    for (const [key, rawDelta] of rawDeltas) {
      const entry = nextLayout.entries.get(key);
      if (!entry) continue;
      const nearestMovingAncestorKey = entry.ancestorKeys.find((ancestorKey) => rawDeltas.has(ancestorKey));
      const residualDelta = rawDelta - (nearestMovingAncestorKey ? rawDeltas.get(nearestMovingAncestorKey) ?? 0 : 0);
      if (residualDelta === 0) continue;
      trackAnimation(entry.element, [
        { transform: `translateY(${residualDelta}px)` },
        { transform: "translateY(0px)" },
      ], {
        duration: SETTLE_DURATION_MS,
        easing: EXPAND_EASING,
      });
    }
  });

  useEffect(() => () => clearVisuals(), []);
}
