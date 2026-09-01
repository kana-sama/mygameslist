import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export const COMPLETED_CHECKLIST_MOTION_DURATION_MS = 280;

export interface CompletedChecklistMotionState {
  enabled: boolean;
  revision: number;
  revealedItemIdsFingerprint: string;
  revealedSectionIdsFingerprint: string;
  snapshotFingerprint: string;
}

interface MotionLayoutEntry {
  ancestorKeys: readonly string[];
  element: HTMLElement;
  key: string;
  listContainerTag: "ol" | "ul" | null;
  rect: MotionRect;
  tableColumnWidths: readonly number[] | null;
  tableRow: boolean;
  tableViewportRect: MotionRect | null;
  target: string | null;
}

interface MotionLayout {
  entries: Map<string, MotionLayoutEntry>;
  hiddenTargets: Map<string, string>;
  summaries: Map<string, MotionRect>;
}

interface MotionRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

const MOTION_KEY_ATTRIBUTE = "data-completed-checklist-motion-key";
const MOTION_TARGET_ATTRIBUTE = "data-completed-checklist-motion-target";
const MOTION_SUMMARY_ATTRIBUTE = "data-completed-checklist-motion-summary";
const MOTION_REPLICA_CLASS = "markdown-completed-checklist-motion-replica";
const MOTION_CLIP_CLASS = "markdown-completed-checklist-motion-clip";
const EXIT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const ENTER_EASING = "cubic-bezier(0, 0, 0.2, 1)";

function motionFingerprint(state: CompletedChecklistMotionState): string {
  return `${state.enabled ? 1 : 0}\u0000${state.revision}\u0000${state.snapshotFingerprint}\u0000${state.revealedItemIdsFingerprint}\u0000${state.revealedSectionIdsFingerprint}`;
}

function rootLocalRect(rect: DOMRect, rootRect: DOMRect): MotionRect {
  return {
    height: rect.height,
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
  };
}

function motionContentFingerprint(root: HTMLDivElement | null): string {
  if (!root) return "";
  return [...root.childNodes].flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [node.textContent ?? ""];
    if (node.classList.contains(MOTION_REPLICA_CLASS) || node.classList.contains(MOTION_CLIP_CLASS)) return [];
    const copy = node.cloneNode(true) as HTMLElement;
    for (const artifact of copy.querySelectorAll(`.${MOTION_REPLICA_CLASS}, .${MOTION_CLIP_CLASS}`)) artifact.remove();
    copy.removeAttribute("style");
    for (const element of copy.querySelectorAll<HTMLElement>("[style]")) element.removeAttribute("style");
    return [copy.outerHTML];
  }).join("\u0000");
}

function measuredTableColumnWidths(element: HTMLElement): readonly number[] | null {
  const table = element.closest("table");
  if (!table) return null;
  const columns = [...table.querySelectorAll<HTMLElement>(":scope > colgroup > col")];
  if (columns.length) return columns.map((column) => column.getBoundingClientRect().width);
  const headerCells = [...table.querySelectorAll<HTMLElement>(":scope > thead > tr > th, :scope > thead > tr > td")];
  if (headerCells.length) return headerCells.map((cell) => cell.getBoundingClientRect().width);
  return [...element.children].flatMap((cell) => cell.hasAttribute("colspan") ? [] : [cell.getBoundingClientRect().width]);
}

function viewportRectFromRootLocal(rect: MotionRect, rootRect: DOMRect): MotionRect {
  return {
    height: rect.height,
    left: rootRect.left + rect.left,
    top: rootRect.top + rect.top,
    width: rect.width,
  };
}

function alignTableReplica(replica: HTMLElement, source: MotionRect): void {
  const replicaRow = replica.querySelector<HTMLElement>("tr");
  if (!replicaRow) return;
  const initial = replicaRow.getBoundingClientRect();
  replica.style.width = `${Number.parseFloat(replica.style.width) + source.width - initial.width}px`;
  replica.style.height = `${Number.parseFloat(replica.style.height) + source.height - initial.height}px`;
  const resized = replicaRow.getBoundingClientRect();
  replica.style.left = `${Number.parseFloat(replica.style.left) + source.left - resized.left}px`;
  replica.style.top = `${Number.parseFloat(replica.style.top) + source.top - resized.top}px`;
}

function collectMotionLayout(root: HTMLDivElement): MotionLayout {
  const hiddenTargets = new Map<string, string>();
  for (const element of root.querySelectorAll<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`)) {
    const key = element.getAttribute(MOTION_KEY_ATTRIBUTE);
    const target = element.getAttribute(MOTION_TARGET_ATTRIBUTE);
    if (key && target && element.closest("[hidden]")) hiddenTargets.set(key, target);
  }
  const entryElements = [...root.querySelectorAll<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`)]
    .filter((element) => !element.closest(`.${MOTION_REPLICA_CLASS}`) && !element.closest("[hidden]"));
  const summaryElements = [...root.querySelectorAll<HTMLElement>(`[${MOTION_SUMMARY_ATTRIBUTE}]`)]
    .filter((element) => !element.closest(`.${MOTION_REPLICA_CLASS}`) && !element.closest("[hidden]"));
  if (!entryElements.length && !summaryElements.length) return { entries: new Map(), hiddenTargets, summaries: new Map() };
  const rootRect = root.getBoundingClientRect();
  const entries = new Map<string, MotionLayoutEntry>();
  for (const element of entryElements) {
    const key = element.getAttribute(MOTION_KEY_ATTRIBUTE);
    if (!key || entries.has(key)) continue;
    const ancestorKeys: string[] = [];
    let ancestor = element.parentElement?.closest<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`) ?? null;
    while (ancestor && root.contains(ancestor)) {
      const ancestorKey = ancestor.getAttribute(MOTION_KEY_ATTRIBUTE);
      if (ancestorKey) ancestorKeys.push(ancestorKey);
      ancestor = ancestor.parentElement?.closest<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`) ?? null;
    }
    entries.set(key, {
      ancestorKeys,
      element,
      key,
      listContainerTag: element.tagName === "LI" && element.parentElement?.tagName === "OL"
        ? "ol"
        : element.tagName === "LI" && element.parentElement?.tagName === "UL" ? "ul" : null,
      rect: rootLocalRect(element.getBoundingClientRect(), rootRect),
      tableColumnWidths: element.tagName === "TR" ? measuredTableColumnWidths(element) : null,
      tableRow: element.tagName === "TR",
      tableViewportRect: element.tagName === "TR"
        ? rootLocalRect(element.closest<HTMLElement>(".markdown-table-scroll")?.getBoundingClientRect() ?? rootRect, rootRect)
        : null,
      target: element.getAttribute(MOTION_TARGET_ATTRIBUTE),
    });
  }
  const summaries = new Map<string, MotionRect>();
  for (const element of summaryElements) {
    const owner = element.getAttribute(MOTION_SUMMARY_ATTRIBUTE);
    if (owner && !summaries.has(owner)) summaries.set(owner, rootLocalRect(element.getBoundingClientRect(), rootRect));
  }
  return { entries, hiddenTargets, summaries };
}

function topLevelEntries(layout: MotionLayout, keys: ReadonlySet<string>): MotionLayoutEntry[] {
  return [...keys].flatMap((key) => {
    const entry = layout.entries.get(key);
    return entry && !entry.ancestorKeys.some((ancestorKey) => keys.has(ancestorKey)) ? [entry] : [];
  });
}

function verticalScale(from: MotionRect, to: MotionRect): number {
  return from.height > 0 ? Math.max(0.01, to.height / from.height) : 1;
}

function stripCloneIds(element: HTMLElement): void {
  element.removeAttribute("id");
  for (const descendant of element.querySelectorAll<HTMLElement>("[id]")) descendant.removeAttribute("id");
}

function createExitReplica(entry: MotionLayoutEntry): HTMLElement {
  const content = entry.element.cloneNode(true) as HTMLElement;
  if (entry.tableRow) {
    content.removeAttribute("hidden");
    const table = document.createElement("table");
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
  if (!entry.listContainerTag) return content;
  const shell = document.createElement(entry.listContainerTag);
  shell.setAttribute(MOTION_KEY_ATTRIBUTE, entry.key);
  if (entry.target) shell.setAttribute(MOTION_TARGET_ATTRIBUTE, entry.target);
  shell.style.padding = "0";
  shell.append(content);
  return shell;
}

export function useCompletedChecklistMotion(
  root: RefObject<HTMLDivElement | null>,
  state: CompletedChecklistMotionState,
): void {
  const previousLayout = useRef<MotionLayout | null>(null);
  const previousContentFingerprint = useRef<string | null>(null);
  const previousFingerprint = useRef<string | null>(null);
  const activeAnimations = useRef(new Set<Animation>());
  const activeClips = useRef(new Set<HTMLElement>());
  const activeHiddenEntries = useRef(new Set<HTMLElement>());
  const activeReplicas = useRef(new Set<HTMLElement>());

  const clearVisuals = (): void => {
    for (const animation of [...activeAnimations.current]) animation.cancel();
    activeAnimations.current.clear();
    for (const entry of activeHiddenEntries.current) entry.style.visibility = "";
    activeHiddenEntries.current.clear();
    for (const replica of activeReplicas.current) replica.remove();
    activeReplicas.current.clear();
    for (const clip of activeClips.current) clip.remove();
    activeClips.current.clear();
  };

  useLayoutEffect(() => {
    const rootElement = root.current;
    const nextFingerprint = motionFingerprint(state);
    const transitionChanged = previousFingerprint.current !== null && previousFingerprint.current !== nextFingerprint;
    const contentFingerprint = motionContentFingerprint(rootElement);
    const contentChanged = previousContentFingerprint.current !== null && previousContentFingerprint.current !== contentFingerprint;
    if (!rootElement) {
      if (transitionChanged || contentChanged) clearVisuals();
      previousLayout.current = null;
      previousContentFingerprint.current = contentFingerprint;
      previousFingerprint.current = nextFingerprint;
      return;
    }
    if (!transitionChanged) {
      previousFingerprint.current = nextFingerprint;
      if (contentChanged) clearVisuals();
      if (activeAnimations.current.size || activeReplicas.current.size) return;
      previousLayout.current = collectMotionLayout(rootElement);
      previousContentFingerprint.current = contentFingerprint;
      return;
    }

    const priorLayout = previousLayout.current;
    clearVisuals();
    const nextLayout = collectMotionLayout(rootElement);
    previousLayout.current = nextLayout;
    previousContentFingerprint.current = contentFingerprint;
    previousFingerprint.current = nextFingerprint;
    if (
      !priorLayout
      || typeof Element.prototype.animate !== "function"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) return;

    const trackAnimation = (
      element: HTMLElement,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
      replica?: HTMLElement,
      clip?: HTMLElement,
    ): void => {
      let animation: Animation;
      try {
        animation = element.animate(keyframes, options);
      } catch {
        replica?.remove();
        if (replica) activeReplicas.current.delete(replica);
        clip?.remove();
        if (clip) activeClips.current.delete(clip);
        return;
      }
      activeAnimations.current.add(animation);
      const cleanup = () => {
        activeAnimations.current.delete(animation);
        if (replica) {
          activeReplicas.current.delete(replica);
          replica.remove();
        }
        if (clip) {
          activeClips.current.delete(clip);
          clip.remove();
        }
      };
      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
    };

    const disappearedKeys = new Set([...priorLayout.entries.keys()].filter((key) => !nextLayout.entries.has(key)));
    for (const entry of topLevelEntries(priorLayout, disappearedKeys)) {
      const target = nextLayout.hiddenTargets.get(entry.key) ?? entry.target;
      if (!target) continue;
      const destination = nextLayout.summaries.get(target);
      if (!destination) continue;
      const replica = createExitReplica(entry);
      stripCloneIds(replica);
      replica.classList.add(MOTION_REPLICA_CLASS);
      replica.setAttribute(MOTION_KEY_ATTRIBUTE, entry.key);
      replica.setAttribute(MOTION_TARGET_ATTRIBUTE, target);
      replica.setAttribute("aria-hidden", "true");
      replica.setAttribute("inert", "");
      replica.style.height = `${entry.rect.height}px`;
      replica.style.margin = "0";
      replica.style.pointerEvents = "none";
      replica.style.transformOrigin = "top left";
      replica.style.width = `${entry.rect.width}px`;
      let clip: HTMLElement | undefined;
      if (entry.tableRow && entry.tableViewportRect) {
        clip = document.createElement("div");
        clip.className = MOTION_CLIP_CLASS;
        clip.style.height = `${entry.tableViewportRect.height}px`;
        clip.style.left = `${entry.tableViewportRect.left}px`;
        clip.style.overflow = "hidden";
        clip.style.pointerEvents = "none";
        clip.style.top = `${entry.tableViewportRect.top}px`;
        clip.style.width = `${entry.tableViewportRect.width}px`;
        replica.style.left = `${entry.rect.left - entry.tableViewportRect.left}px`;
        replica.style.top = `${entry.rect.top - entry.tableViewportRect.top}px`;
        clip.append(replica);
        rootElement.append(clip);
        activeClips.current.add(clip);
        alignTableReplica(replica, viewportRectFromRootLocal(entry.rect, rootElement.getBoundingClientRect()));
      } else {
        replica.style.left = `${entry.rect.left}px`;
        replica.style.top = `${entry.rect.top}px`;
        rootElement.append(replica);
      }
      activeReplicas.current.add(replica);
      trackAnimation(replica, [
        { opacity: 1, transform: "translateY(0px) scaleY(1)" },
        { opacity: 0, transform: `translateY(${destination.top - entry.rect.top}px) scaleY(${verticalScale(entry.rect, destination)})` },
      ], {
        duration: COMPLETED_CHECKLIST_MOTION_DURATION_MS,
        easing: EXIT_EASING,
        fill: "forwards",
      }, replica, clip);
    }

    const appearedKeys = new Set([...nextLayout.entries.keys()].filter((key) => !priorLayout.entries.has(key)));
    for (const entry of topLevelEntries(nextLayout, appearedKeys)) {
      const target = priorLayout.hiddenTargets.get(entry.key) ?? entry.target;
      if (!target) continue;
      const origin = priorLayout.summaries.get(target);
      if (!origin) continue;
      if (entry.tableRow) {
        const replica = createExitReplica(entry);
        stripCloneIds(replica);
        replica.classList.add(MOTION_REPLICA_CLASS);
        replica.setAttribute("aria-hidden", "true");
        replica.setAttribute("inert", "");
        replica.style.height = `${entry.rect.height}px`;
        replica.style.margin = "0";
        replica.style.pointerEvents = "none";
        replica.style.transformOrigin = "top left";
        replica.style.width = `${entry.rect.width}px`;
        let clip: HTMLElement | undefined;
        if (entry.tableViewportRect) {
          clip = document.createElement("div");
          clip.className = MOTION_CLIP_CLASS;
          clip.style.height = `${entry.tableViewportRect.height}px`;
          clip.style.left = `${entry.tableViewportRect.left}px`;
          clip.style.overflow = "hidden";
          clip.style.pointerEvents = "none";
          clip.style.top = `${entry.tableViewportRect.top}px`;
          clip.style.width = `${entry.tableViewportRect.width}px`;
          replica.style.left = `${entry.rect.left - entry.tableViewportRect.left}px`;
          replica.style.top = `${entry.rect.top - entry.tableViewportRect.top}px`;
          clip.append(replica);
          rootElement.append(clip);
          activeClips.current.add(clip);
        } else {
          replica.style.left = `${entry.rect.left}px`;
          replica.style.top = `${entry.rect.top}px`;
          rootElement.append(replica);
        }
        alignTableReplica(replica, entry.element.getBoundingClientRect());
        entry.element.style.visibility = "hidden";
        activeHiddenEntries.current.add(entry.element);
        activeReplicas.current.add(replica);
        let animation: Animation;
        const cleanup = () => {
          activeAnimations.current.delete(animation);
          activeReplicas.current.delete(replica);
          activeHiddenEntries.current.delete(entry.element);
          entry.element.style.visibility = "";
          replica.remove();
          if (clip) {
            activeClips.current.delete(clip);
            clip.remove();
          }
        };
        try {
          animation = replica.animate([
            { opacity: 0, transform: `translateY(${origin.top - entry.rect.top}px) scaleY(${verticalScale(entry.rect, origin)})` },
            { opacity: 1, transform: "translateY(0px) scaleY(1)" },
          ], {
            duration: COMPLETED_CHECKLIST_MOTION_DURATION_MS,
            easing: ENTER_EASING,
          });
          activeAnimations.current.add(animation);
          animation.onfinish = cleanup;
          animation.oncancel = cleanup;
        } catch {
          cleanup();
        }
        continue;
      }
      trackAnimation(entry.element, [
        { opacity: 0, transform: `translateY(${origin.top - entry.rect.top}px) scaleY(${verticalScale(entry.rect, origin)})`, transformOrigin: "top left" },
        { opacity: 1, transform: "translateY(0px) scaleY(1)", transformOrigin: "top left" },
      ], {
        duration: COMPLETED_CHECKLIST_MOTION_DURATION_MS,
        easing: ENTER_EASING,
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
        duration: COMPLETED_CHECKLIST_MOTION_DURATION_MS,
        easing: ENTER_EASING,
      });
    }
  });

  useEffect(() => () => clearVisuals(), []);
}
