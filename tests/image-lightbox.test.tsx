import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "../src/components/ImageLightbox";
import type { Asset, Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "a".repeat(64);
const NOW = "2026-07-17T06:00:00.000Z";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({ left, top, width, height }) } as DOMRect;
}

function scaleOf(image: HTMLElement): number {
  return Number(image.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 0);
}

function LightboxHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <><button onClick={() => setOpen(true)} ref={triggerRef} type="button">Открыть тест</button>{open ? <ImageLightbox alt="Карта уровня" height={600} onClose={() => setOpen(false)} src="https://example.com/map.webp" triggerRef={triggerRef} width={800} /> : null}</>;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("note image lightbox", () => {
  it("opens a tall media-only image without collapsing it or entering note editing", async () => {
    const user = userEvent.setup();
    const game: Game = { id: GAME_ID, title: "DuckTales", coverAssetId: null, platforms: ["NES"], tags: [], status: "playing", placement: { tierId: "a", rank: 1024 }, reviewMarkdown: "", createdAt: NOW, updatedAt: NOW };
    const note: Note = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "", attachments: [{ type: "image", assetId: ASSET_ID, alt: "Карта уровня" }], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const asset: Asset = { id: ASSET_ID, kind: "image", mime: "image/webp", width: 1280, height: 720, byteLength: 100, alt: "Карта уровня", originalName: "map.webp" };
    const onSave = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".note-card__content")) return domRect(0, 0, 500, 420);
      return domRect(0, 0, 800, 600);
    });

    render(<GamePage assets={{ [ASSET_ID]: asset }} game={game} mode="game" notes={[note]} onSave={onSave} resolveAssetUrl={() => "https://example.com/map.webp"} />);
    const opener = screen.getByRole("button", { name: "Открыть изображение «Карта уровня»" });
    const card = opener.closest("article")!;
    expect(card).not.toHaveClass("note-card--collapsed");
    expect(card).toHaveClass("note-card--media-only");
    expect(card).not.toHaveAttribute("tabindex");
    expect(card.querySelector(".note-card__viewport")).not.toHaveAttribute("inert");
    expect(within(card).queryByRole("button", { name: "Развернуть заметку" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Показать изображение полностью" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Перетащить заметку" })).toHaveAttribute("aria-roledescription", "перетаскиваемая заметка");
    const editButton = within(card).getByRole("button", { name: "Редактировать заметку" });

    opener.focus();
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Просмотр изображения: Карта уровня" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toBe(document.body);
    expect(within(dialog).getByRole("img", { name: "Карта уровня" })).toHaveAttribute("src", "https://example.com/map.webp");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Закрыть просмотр изображения" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();

    await user.click(editButton);
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Открыть изображение «Карта уровня»" })).toBeInTheDocument();
  });

  it("collapses only extreme portrait images while keeping lightbox and editing available", async () => {
    const user = userEvent.setup();
    const game: Game = { id: GAME_ID, title: "Wario Land 3", coverAssetId: null, platforms: ["GameBoy Color"], tags: [], status: "playing", placement: { tierId: "b", rank: 1024 }, reviewMarkdown: "", createdAt: NOW, updatedAt: NOW };
    const note: Note = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "", attachments: [{ type: "image", assetId: ASSET_ID, alt: "Карта переходов" }], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const asset: Asset = { id: ASSET_ID, kind: "image", mime: "image/webp", width: 520, height: 3800, byteLength: 39_000, alt: "Карта переходов", originalName: "map.png" };

    render(<GamePage assets={{ [ASSET_ID]: asset }} game={game} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => "https://example.com/tall-map.webp"} />);

    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const shell = card.querySelector<HTMLElement>(".note-attachment-shell")!;
    const expand = within(card).getByRole("button", { name: "Показать изображение полностью" });
    expect(card).not.toHaveClass("note-card--collapsed");
    expect(shell).toHaveClass("note-attachment-shell--tall-image", "is-collapsed");
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(within(card).getByRole("button", { name: "Открыть изображение «Карта переходов»" }));
    expect(screen.getByRole("dialog", { name: "Просмотр изображения: Карта переходов" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Закрыть просмотр изображения" }));

    await user.click(expand);
    expect(shell).toHaveClass("is-expanded");
    expect(shell).not.toHaveClass("is-collapsed");
    expect(within(card).getByRole("button", { name: "Свернуть изображение" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать изображение полностью" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Свернуть изображение" })).not.toBeInTheDocument();
  });

  it("does not open a text note editor when a portaled lightbox click closes the image", async () => {
    const user = userEvent.setup();
    const game: Game = { id: GAME_ID, title: "DuckTales", coverAssetId: null, platforms: ["NES"], tags: [], status: "playing", placement: { tierId: "a", rank: 1024 }, reviewMarkdown: "", createdAt: NOW, updatedAt: NOW };
    const note: Note = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "Маршрут уровня", attachments: [{ type: "image", assetId: ASSET_ID, alt: "Карта уровня" }], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const asset: Asset = { id: ASSET_ID, kind: "image", mime: "image/webp", width: 1280, height: 720, byteLength: 100, alt: "Карта уровня", originalName: "map.webp" };

    render(<GamePage assets={{ [ASSET_ID]: asset }} game={game} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => "https://example.com/map.webp"} />);
    await user.click(screen.getByRole("button", { name: "Открыть изображение «Карта уровня»" }));

    const stage = screen.getByRole("dialog").querySelector<HTMLElement>(".image-lightbox__stage")!;
    fireEvent.click(stage);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("zooms around the pointer, supports pinch and pan, and resets with 0", async () => {
    const user = userEvent.setup();
    render(<LightboxHarness />);
    await user.click(screen.getByRole("button", { name: "Открыть тест" }));
    const dialog = screen.getByRole("dialog");
    const stage = dialog.querySelector<HTMLElement>(".image-lightbox__stage")!;
    const image = within(dialog).getByRole("img");
    Object.defineProperties(stage, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } });
    Object.defineProperties(image, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } });
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(domRect(0, 0, 800, 600));

    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 600, clientY: 300, deltaY: -200 });
    fireEvent(stage, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    await waitFor(() => expect(scaleOf(image)).toBeGreaterThan(1));
    expect(image.style.transform).not.toContain("translate3d(0px, 0px");

    const gestureStart = Object.assign(new Event("gesturestart", { bubbles: true, cancelable: true }), { clientX: 400, clientY: 300, scale: 1 });
    const gestureChange = Object.assign(new Event("gesturechange", { bubbles: true, cancelable: true }), { clientX: 400, clientY: 300, scale: 1.5 });
    fireEvent(stage, gestureStart);
    fireEvent(stage, gestureChange);
    expect(gestureStart.defaultPrevented).toBe(true);
    expect(gestureChange.defaultPrevented).toBe(true);
    await waitFor(() => expect(scaleOf(image)).toBeGreaterThan(2));

    fireEvent.keyDown(document, { key: "0" });
    expect(scaleOf(image)).toBe(1);
    await user.dblClick(image);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(scaleOf(image)).toBe(2);
    await user.dblClick(image);
    expect(scaleOf(image)).toBe(1);

    fireEvent.pointerDown(stage, { button: 0, clientX: 300, clientY: 300, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerDown(stage, { button: 0, clientX: 400, clientY: 300, pointerId: 2, pointerType: "touch" });
    fireEvent.pointerMove(stage, { clientX: 500, clientY: 300, pointerId: 2, pointerType: "touch" });
    await waitFor(() => expect(scaleOf(image)).toBeCloseTo(2, 1));
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 300, pointerId: 2, pointerType: "touch" });
    const beforePan = image.style.transform;
    fireEvent.pointerMove(stage, { clientX: 350, clientY: 340, pointerId: 1, pointerType: "touch" });
    expect(image.style.transform).not.toBe(beforePan);
    fireEvent.pointerUp(stage, { clientX: 350, clientY: 340, pointerId: 1, pointerType: "touch" });
  });

  it("zooms a very tall image from its intrinsic pixels instead of a fitted raster", async () => {
    const user = userEvent.setup();
    render(<ImageLightbox alt="Карта переходов" height={3800} onClose={vi.fn()} src="https://example.com/tall-map.webp" width={520} />);
    const dialog = screen.getByRole("dialog");
    const stage = dialog.querySelector<HTMLElement>(".image-lightbox__stage")!;
    const image = within(dialog).getByRole("img", { name: "Карта переходов" });
    Object.defineProperties(stage, { clientWidth: { configurable: true, value: 974 }, clientHeight: { configurable: true, value: 650 } });
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(domRect(0, 0, 974, 650));

    fireEvent.load(image);

    await waitFor(() => expect(scaleOf(image)).toBeCloseTo(650 / 3800, 5));
    expect(image.style.width).toBe("520px");
    expect(image.style.height).toBe("3800px");
    expect(image.style.left).toBe("calc(50% - 260px)");
    expect(image.style.top).toBe("calc(50% - 1900px)");
    expect(image.style.transform).not.toContain("translate3d");
    expect(520 * scaleOf(image)).toBeCloseTo(88.95, 1);
    expect(stage).not.toHaveClass("is-zoomed");

    await user.dblClick(image);

    expect(scaleOf(image)).toBe(1);
    expect(520 * scaleOf(image)).toBe(520);
    expect(stage).toHaveClass("is-zoomed");

    fireEvent.keyDown(document, { key: "0" });
    expect(scaleOf(image)).toBeCloseTo(650 / 3800, 5);
    expect(stage).not.toHaveClass("is-zoomed");
  });

  it("closes only on an un-dragged backdrop click and restores the previous scroll lock", async () => {
    const user = userEvent.setup();
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.append(appRoot);
    document.body.style.overflow = "clip";
    render(<LightboxHarness />, { container: appRoot });
    const opener = screen.getByRole("button", { name: "Открыть тест" });
    await user.click(opener);
    expect(document.body.style.overflow).toBe("hidden");
    expect(appRoot).toHaveAttribute("inert");
    const stage = document.querySelector<HTMLElement>(".image-lightbox__stage")!;

    fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(stage, { clientX: 140, clientY: 100, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerUp(stage, { clientX: 140, clientY: 100, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(stage);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(stage);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("clip");
    expect(appRoot).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });
});
