import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  graphProgress,
  parseGraph,
  setGraphGroupState,
  setGraphTaskState,
  type GraphState,
} from "../../domain/graph";
import { graphLayoutKey } from "./layout";
import { GraphLayoutClient } from "./layoutClient";
import type { GraphGeometry } from "./layoutTypes";
import "./graphNote.css";

export interface GraphNoteProps {
  source: string;
  onSourceChange?: (next: string) => void | Promise<void>;
  disabled?: boolean;
  onTitle?: (title: string | undefined) => void;
  className?: string;
}
const kindNames = {
  normal: "Задача",
  special: "Особая",
  milestone: "Веха",
  note: "Заметка",
};
function Checkbox({
  state,
  label,
  disabled,
  onToggle,
}: {
  state: GraphState;
  label: string;
  disabled: boolean;
  onToggle: (partial: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      className="graph-note__checkbox"
      aria-label={label}
      aria-checked={state === "doing" ? "mixed" : state === "done"}
      aria-disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle(e.shiftKey);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) onToggle(e.shiftKey);
        }
      }}
    >
      {state === "done" ? "✓" : state === "doing" ? "−" : ""}
    </button>
  );
}
export function GraphNote({
  source,
  onSourceChange,
  disabled = false,
  onTitle,
  className = "",
}: GraphNoteProps) {
  const host = useRef<HTMLDivElement>(null);
  const client = useRef<GraphLayoutClient | null>(null);
  const saving = useRef(false);
  const [width, setWidth] = useState(720);
  const [font, setFont] = useState("");
  const [geometry, setGeometry] = useState<GraphGeometry | null>(null);
  const [layoutError, setLayoutError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const parsed = useMemo(() => {
    try {
      return { graph: parseGraph(source), error: "" };
    } catch (error) {
      return {
        graph: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [source]);
  const graph = parsed.graph;
  const key = graph ? graphLayoutKey(graph, width, font) : "";
  const marker = `graph-arrow-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    onTitle?.(graph?.label);
  }, [graph?.label, onTitle]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setFont(getComputedStyle(element).fontFamily);
    const update = (next: number) => {
      if (next > 0) setWidth(Math.round(next));
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    client.current = new GraphLayoutClient();
    return () => {
      client.current?.dispose();
      client.current = null;
    };
  }, []);
  useEffect(() => {
    if (!graph?.nodes.length) {
      setGeometry(null);
      setLayoutError("");
      return;
    }
    let active = true;
    setLayoutError("");
    client.current?.layout(graph, width, font).then(
      (result) => {
        if (active) setGeometry(result);
      },
      (error) => {
        if (active) {
          setGeometry(null);
          setLayoutError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    );
    return () => {
      active = false;
    };
    // The structural key deliberately ignores task state and source ranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);
  const write = async (next: string) => {
    if (disabled || saving.current || !onSourceChange) return;
    saving.current = true;
    setPending(true);
    setSaveError("");
    try {
      await onSourceChange(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  const inactive = disabled || pending || !onSourceChange;
  const toggleNode = (id: string, partial: boolean) => {
    if (!graph || inactive) return;
    const node = graph.nodes.find((n) => n.id === id)!;
    const state: GraphState = partial
      ? node.state === "doing"
        ? "todo"
        : "doing"
      : node.state === "done"
        ? "todo"
        : "done";
    void write(setGraphTaskState(source, id, state));
  };
  const toggleGroup = (id: string) => {
    if (!graph || inactive) return;
    void write(
      setGraphGroupState(
        source,
        id,
        graphProgress(graph, id).state === "done" ? "todo" : "done",
      ),
    );
  };
  return (
    <div
      ref={host}
      className={`graph-note ${className}`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {graph?.label && <h3 className="graph-note__title">{graph.label}</h3>}
      {parsed.error ? (
        <p className="graph-note__error" role="alert">
          {parsed.error}
        </p>
      ) : !graph?.nodes.length ? (
        <p className="graph-note__status">Граф пуст</p>
      ) : layoutError ? (
        <div className="graph-note__error" role="alert">
          {layoutError}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : !geometry ? (
        <p className="graph-note__status" role="status">
          Загрузка графа…
        </p>
      ) : (
        <div
          className="graph-note__viewport"
          tabIndex={geometry.width > width ? 0 : undefined}
          aria-label="Схема графа"
        >
          <div
            className="graph-note__canvas"
            style={{ width: geometry.width, height: geometry.height }}
          >
            {geometry.groups.map((box) => {
              const group = graph.groups.find((g) => g.id === box.id);
              if (!group) return null;
              const progress = graphProgress(graph, group.id);
              return (
                <div
                  key={group.id}
                  data-graph-group={group.id}
                  data-parent={group.parentId ?? ""}
                  data-kind={group.kind}
                  data-depth={box.depth}
                  data-state={progress.state}
                  className={`graph-note__group ${group.kind === "section" ? "graph-note__section" : ""}`}
                  style={
                    {
                      left: box.x,
                      top: box.y,
                      width: box.width,
                      height: box.height,
                      "--graph-depth": box.depth,
                    } as React.CSSProperties
                  }
                >
                  <div
                    className={`graph-note__group-header ${!group.label ? "is-untitled" : ""}`}
                  >
                    {group.label && (
                      <span className="graph-note__group-title">
                        {box.labelLines.map((line, i) => (
                          <span key={i}>{line}</span>
                        ))}
                      </span>
                    )}
                    {progress.total > 0 && (
                      <span className="graph-note__progress">
                        <span>
                          {progress.done}/{progress.total}
                        </span>
                        <Checkbox
                          state={progress.state}
                          label={`${group.label ?? "Группа"}: ${progress.done}/${progress.total}`}
                          disabled={inactive}
                          onToggle={() => toggleGroup(group.id)}
                        />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <svg
              className="graph-note__edges"
              width={geometry.width}
              height={geometry.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={marker}
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" />
                </marker>
              </defs>
              {geometry.edges.map((edge) => (
                <g key={edge.index} data-graph-edge={edge.index}>
                  <path d={edge.path} markerEnd={`url(#${marker})`} />
                  {edge.label && (
                    <text x={edge.x} y={edge.y + 12} textAnchor="middle">
                      {edge.labelLines.map((line, i) => (
                        <tspan key={i} x={edge.x} dy={i ? 14 : 0}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            {geometry.nodes.map((box) => {
              const node = graph.nodes.find((n) => n.id === box.id);
              if (!node) return null;
              return (
                <div
                  key={node.id}
                  data-graph-node={node.id}
                  data-parent={node.parentId ?? ""}
                  data-kind={node.kind}
                  data-state={node.state}
                  className={`graph-note__node ${node.task ? "is-task" : ""}`}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                  }}
                >
                  {node.task && (
                    <Checkbox
                      state={node.state}
                      label={`${kindNames[node.kind]}: ${node.label}${node.subtitle ? ` — ${node.subtitle}` : ""}`}
                      disabled={inactive}
                      onToggle={(partial) => toggleNode(node.id, partial)}
                    />
                  )}
                  <span className="graph-note__node-text">
                    <span className="graph-note__label">
                      {box.labelLines.map((line, i) => (
                        <span key={i}>{line}</span>
                      ))}
                    </span>
                    {box.subtitleLines.length > 0 && (
                      <span className="graph-note__subtitle">
                        {box.subtitleLines.map((line, i) => (
                          <span key={i}>{line}</span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {saveError && (
        <p role="alert" className="graph-note__error">
          {saveError}
        </p>
      )}
    </div>
  );
}
