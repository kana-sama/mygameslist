import { lazy, Suspense } from "react";
import type { GraphNoteProps } from "./graph/GraphNote";
const GraphNote = lazy(() => import("./graph/GraphNote").then(module => ({ default: module.GraphNote })));
export function LazyGraphNote(props: GraphNoteProps) {
  return <Suspense fallback={<p role="status">Загружаем граф…</p>}><GraphNote {...props} /></Suspense>;
}
