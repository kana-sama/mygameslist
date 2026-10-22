import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

vi.mock("../src/components/smart/SmartNote", async () => {
  const { useLayoutEffect, useRef } = await import("react");
  return {
    ConnectedSmartNote: ({ note }: { note: Pick<Note, "id" | "smart"> }) => {
      const preview = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => {
        const root = preview.current!.attachShadow({ mode: "open" });
        const button = document.createElement("button");
        button.textContent = "Synthetic preview control";
        root.append(button);
      }, []);
      return <><h1><button type="button">{note.smart!.title}</button></h1><div data-smart-mount="preview" ref={preview} /></>;
    },
  };
});

const NOW = "2026-01-01T00:00:00.000Z";
const game: Game = {
  id: "synthetic-game", title: "Synthetic game", coverAssetId: null,
  platforms: [], tags: [], status: "playing", placement: { tierId: "a", rank: 1024 },
  reviewMarkdown: "", createdAt: NOW, updatedAt: NOW,
};
const smart: Note = {
  id: "synthetic-smart", gameId: game.id, format: "smart", bodyMarkdown: "",
  attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW,
  smart: {
    version: 1, apiVersion: 1, title: "Synthetic smart title",
    entrypoints: { preview: "preview.js" }, program: { hash: "a".repeat(64), files: [] },
  },
};
const ordinary: Note = {
  id: "synthetic-markdown", gameId: game.id, bodyMarkdown: "- [ ] Synthetic task",
  attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW,
};

afterEach(cleanup);

describe("smart note card activity", () => {
  it.each(["pointerdown", "click", "focusin"])("shares activity for %s on the shell, title and Shadow DOM control", (eventType) => {
    const onSave = vi.fn();
    render(<><button type="button">Outside</button><GamePage assets={{}} game={game} mode="game" notes={[smart, ordinary]} onSave={onSave} /></>);
    const smartCard = document.querySelector<HTMLElement>(`[data-note-id="${smart.id}"]`)!;
    const ordinaryCard = document.querySelector<HTMLElement>(`[data-note-id="${ordinary.id}"]`)!;
    const shadowButton = smartCard.querySelector('[data-smart-mount="preview"]')!.shadowRoot!.querySelector("button")!;
    const title = screen.getByRole("button", { name: smart.smart!.title });
    const outside = screen.getByRole("button", { name: "Outside" });
    const interact = (target: Element) => act(() => {
      const options = { bubbles: true, composed: true };
      target.dispatchEvent(eventType === "focusin" ? new FocusEvent(eventType, options) : new MouseEvent(eventType, options));
    });
    const expectOnlyActive = (card?: HTMLElement) => {
      expect([...document.querySelectorAll(".note-card--interaction-active")]).toEqual(card ? [card] : []);
    };

    expectOnlyActive();
    for (const target of [smartCard, title, shadowButton]) {
      interact(target);
      expectOnlyActive(smartCard);
      fireEvent.pointerMove(document.body);
      fireEvent.pointerOut(smartCard);
      expectOnlyActive(smartCard);
      // Transfer both ways without relying on a preceding pointer event for click/focus.
      fireEvent.focusIn(ordinaryCard.querySelector("input")!);
      expectOnlyActive(ordinaryCard);
      interact(target);
      expectOnlyActive(smartCard);
      interact(outside);
      expectOnlyActive();
    }
    expect(onSave).not.toHaveBeenCalled();
  });
});
