import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { DiffDialog } from "../src/components/DiffDialog";
import { buildChangeReview } from "../src/domain/changeReview";
import { diffLibrary } from "../src/domain/patch";
import { fixtureDatabase, NOTE_EMPTY_ID, NOW } from "./fixtures/source-tree";

it("renders graph changes as escaped source with no rich content or task widgets", () => {
  const base = fixtureDatabase(), next = fixtureDatabase();
  const source = 'digraph { label="Map"; a [label="<img src=x> - [ ] Task"]; }';
  next.notes[NOTE_EMPTY_ID] = { ...next.notes[NOTE_EMPTY_ID], format: "graph", bodyMarkdown: source };
  const { container } = render(<DiffDialog open review={buildChangeReview(base, next, diffLibrary(base, next, { changedAt: NOW }))}
    selection={{ enabled: false, explicitSelectionIds: new Set(), selectedSelectionIds: new Set(), dependencySelectionIds: new Set(), dependencyLabels: {}, selectedPaths: undefined }}
    patchBytes={1} onEnterSelection={() => {}} onToggleChange={() => {}} onToggleGame={() => {}} onClose={() => {}} onExport={() => {}} onImport={() => {}} />);
  expect(container.querySelector("pre")?.textContent).toContain(source);
  expect(container.querySelector('img[src="x"]')).toBeNull();
  expect(container.querySelector('pre input[type="checkbox"]')).toBeNull();
});
