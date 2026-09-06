import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deriveDeploymentStatus, emptyDeploymentObservation, type DeploymentStatusSnapshot } from "../state/deploymentStatusModel";
import "./deployment-status.css";

export interface DeploymentStatusIndicatorProps { snapshot: DeploymentStatusSnapshot }

export const passiveDeploymentStatus = deriveDeploymentStatus({
  development: false, ready: false, documentCommitSha: null, dataCommitSha: null,
}, emptyDeploymentObservation(), 0);

const knownStates = new Set([
  "checking", "development", "unknown-version", "current", "waiting-run", "building",
  "propagating", "update-available", "not-published", "docs-only", "unconfirmed", "error",
]);

export function DeploymentStatusIndicator({ snapshot }: DeploymentStatusIndicatorProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hover = useRef<Element | null>(null);
  const focus = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transient, setTransient] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 320, maxHeight: 320 });
  const open = !suppressed && (pinned || transient);
  const color = knownStates.has(snapshot.state) && ["green", "yellow", "red", "gray"].includes(snapshot.color) ? snapshot.color : "gray";
  const clearCloseTimer = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const enter = () => { clearCloseTimer(); setSuppressed(false); setTransient(true); };
  const leave = () => {
    clearCloseTimer();
    // Give the pointer time to cross the small gap between the trigger and portal.
    closeTimer.current = setTimeout(() => {
      if (!hover.current && !focus.current) setTransient(false);
    }, 150);
  };
  const close = () => {
    clearCloseTimer();
    // Removing a hovered portal does not dispatch pointerleave. Retain only
    // hover that still belongs to the trigger, which remains mounted.
    if (hover.current === tooltip.current) hover.current = null;
    setPinned(false); setTransient(false); setSuppressed(true);
  };
  const contains = (target: EventTarget | null) => target instanceof Node && (trigger.current?.contains(target) || tooltip.current?.contains(target));

  useEffect(() => () => clearCloseTimer(), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!contains(event.target)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, Math.max(0, window.innerWidth - 16));
      const top = Math.max(8, rect.bottom + 5);
      setPosition({
        width, top,
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)),
        maxHeight: Math.max(0, window.innerHeight - top - 8),
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);

  const pointerEvents = {
    onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType !== "touch") { hover.current = event.currentTarget; enter(); } },
    onPointerLeave: (event: React.PointerEvent) => { if (event.pointerType !== "touch") { if (hover.current === event.currentTarget) hover.current = null; leave(); } },
    onFocus: () => { focus.current = true; enter(); },
    onBlur: (event: React.FocusEvent) => { focus.current = Boolean(contains(event.relatedTarget)); if (!focus.current) leave(); },
  };

  return <div className="deployment-status" data-color={color}>
    <button {...pointerEvents} ref={trigger} className="deployment-status__trigger" type="button"
      aria-label={`Версия сайта: ${snapshot.title}`} aria-describedby={open ? id : undefined}
      onClick={() => { if (pinned && !suppressed) close(); else { setSuppressed(false); setPinned(true); } }}>
      <span className="deployment-status__dot" aria-hidden="true" />
    </button>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{snapshot.title}. {snapshot.description}</span>
    {open && createPortal(<div {...pointerEvents} ref={tooltip} id={id} role="tooltip" className="deployment-status__tooltip" style={position}>
      <strong>{snapshot.title}</strong>
      <p>{snapshot.description}</p>
      <dl>
        {snapshot.documentCommitSha && <><dt>Документ</dt><dd>{snapshot.documentCommitSha.slice(0, 7)}</dd></>}
        {snapshot.dataCommitSha && <><dt>База</dt><dd>{snapshot.dataCommitSha.slice(0, 7)}</dd></>}
        {snapshot.headCommitSha && <><dt>main</dt><dd>{snapshot.headCommitSha.slice(0, 7)}</dd></>}
      </dl>
      {snapshot.lastCheckedAt !== null && <p className="deployment-status__checked">Последняя успешная проверка: <time dateTime={new Date(snapshot.lastCheckedAt).toISOString()}>{new Date(snapshot.lastCheckedAt).toLocaleString("ru-RU")}</time></p>}
    </div>, document.body)}
  </div>;
}
