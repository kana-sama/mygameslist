import { createContext, useContext, type Context } from "react";

export interface MarkdownRichTooltipOpenRequest {
  bodyMarkdown: string;
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
