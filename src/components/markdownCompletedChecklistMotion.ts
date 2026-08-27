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
  target: string | null;
}

interface MotionLayout {
  entries: Map<string, MotionLayoutEntry>;
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

function collectMotionLayout(root: HTMLDivElement): MotionLayout {
  const entryElements = [...root.querySelectorAll<HTMLElement>(`[${MOTION_KEY_ATTRIBUTE}]`)]
    .filter((element) => !element.closest(".markdown-completed-checklist-motion-replica"));
  const summaryElements = [...root.querySelectorAll<HTMLElement>(`[${MOTION_SUMMARY_ATTRIBUTE}]`)]
    .filter((element) => !element.closest(".markdown-completed-checklist-motion-replica"));
  if (!entryElements.length && !summaryElements.length) return { entries: new Map(), summaries: new Map() };
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
      target: element.getAttribute(MOTION_TARGET_ATTRIBUTE),
    });
  }
  const summaries = new Map<string, MotionRect>();
  for (const element of summaryElements) {
    const owner = element.getAttribute(MOTION_SUMMARY_ATTRIBUTE);
    if (owner && !summaries.has(owner)) summaries.set(owner, rootLocalRect(element.getBoundingClientRect(), rootRect));
  }
  return { entries, summaries };
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
  const previousFingerprint = useRef<string | null>(null);
  const activeAnimations = useRef(new Set<Animation>());
  const activeReplicas = useRef(new Set<HTMLElement>());

  const clearVisuals = (): void => {
    for (const animation of [...activeAnimations.current]) animation.cancel();
    activeAnimations.current.clear();
    for (const replica of activeReplicas.current) replica.remove();
    activeReplicas.current.clear();
  };

  useLayoutEffect(() => {
    const rootElement = root.current;
    const nextFingerprint = motionFingerprint(state);
    const transitionChanged = previousFingerprint.current !== null && previousFingerprint.current !== nextFingerprint;
    if (!rootElement) {
      if (transitionChanged) clearVisuals();
      previousLayout.current = null;
      previousFingerprint.current = nextFingerprint;
      return;
    }
    if (!transitionChanged) {
      previousFingerprint.current = nextFingerprint;
      if (activeAnimations.current.size || activeReplicas.current.size) return;
      previousLayout.current = collectMotionLayout(rootElement);
      return;
    }

    const priorLayout = previousLayout.current;
    clearVisuals();
    const nextLayout = collectMotionLayout(rootElement);
    previousLayout.current = nextLayout;
    previousFingerprint.current = nextFingerprint;
    if (
      !priorLayout
      || typeof Element.prototype.animate !== "function"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) return;

    const trackAnimation = (element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions, replica?: HTMLElement): void => {
      let animation: Animation;
      try {
        animation = element.animate(keyframes, options);
      } catch {
        replica?.remove();
        if (replica) activeReplicas.current.delete(replica);
        return;
      }
      activeAnimations.current.add(animation);
      const cleanup = () => {
        activeAnimations.current.delete(animation);
        if (replica) {
          activeReplicas.current.delete(replica);
          replica.remove();
        }
      };
      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
    };

    const disappearedKeys = new Set([...priorLayout.entries.keys()].filter((key) => !nextLayout.entries.has(key)));
    for (const entry of topLevelEntries(priorLayout, disappearedKeys)) {
      if (!entry.target) continue;
      const destination = nextLayout.summaries.get(entry.target);
      if (!destination) continue;
      const replica = createExitReplica(entry);
      stripCloneIds(replica);
      replica.classList.add("markdown-completed-checklist-motion-replica");
      replica.setAttribute("aria-hidden", "true");
      replica.setAttribute("inert", "");
      replica.style.height = `${entry.rect.height}px`;
      replica.style.left = `${entry.rect.left}px`;
      replica.style.margin = "0";
      replica.style.pointerEvents = "none";
      replica.style.top = `${entry.rect.top}px`;
      replica.style.transformOrigin = "top left";
      replica.style.width = `${entry.rect.width}px`;
      rootElement.append(replica);
      activeReplicas.current.add(replica);
      trackAnimation(replica, [
        { opacity: 1, transform: "translateY(0px) scaleY(1)" },
        { opacity: 0, transform: `translateY(${destination.top - entry.rect.top}px) scaleY(${verticalScale(entry.rect, destination)})` },
      ], {
        duration: COMPLETED_CHECKLIST_MOTION_DURATION_MS,
        easing: EXIT_EASING,
        fill: "forwards",
      }, replica);
    }

    const appearedKeys = new Set([...nextLayout.entries.keys()].filter((key) => !priorLayout.entries.has(key)));
    for (const entry of topLevelEntries(nextLayout, appearedKeys)) {
      if (!entry.target) continue;
      const origin = priorLayout.summaries.get(entry.target);
      if (!origin) continue;
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
