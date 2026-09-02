import { createContext, useContext, type Context } from "react";
import type { MarkdownRichTooltipDefinition } from "../domain/markdownRichTooltips";

export interface MarkdownRichTooltipRegistry {
  definitions: ReadonlyMap<string, MarkdownRichTooltipDefinition>;
  duplicateAnchors: ReadonlySet<string>;
}

export interface MarkdownRichTooltipBodyChange {
  anchor: string;
  expectedBodyMarkdown: string;
  nextBodyMarkdown: string;
}

export type MarkdownRichTooltipBodyChangeHandler = (
  change: MarkdownRichTooltipBodyChange,
) => boolean | Promise<boolean>;

export type MarkdownRichTooltipLayer = "note" | "palette";

export interface MarkdownRichTooltipOpenRequest {
  anchor: string;
  bodyMarkdown: string;
  layer: MarkdownRichTooltipLayer;
  onBodyChange?: MarkdownRichTooltipBodyChangeHandler;
  registry: MarkdownRichTooltipRegistry;
  sourceElement: HTMLButtonElement;
  title: string;
}

export interface MarkdownRichTooltipController {
  getActiveSource(): HTMLButtonElement | null;
  open(request: MarkdownRichTooltipOpenRequest): void;
  subscribeActiveSource(listener: () => void): () => void;
}

export const MarkdownRichTooltipContext: Context<MarkdownRichTooltipController | null> = createContext<MarkdownRichTooltipController | null>(null);

export function useMarkdownRichTooltipController(): MarkdownRichTooltipController | null {
  return useContext(MarkdownRichTooltipContext);
}
