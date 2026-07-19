import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RandomGameButton } from "../src/components/RandomGameButton";
import {
  createRandomGameRoll,
  getRandomGameCandidates,
  RANDOM_GAME_FINAL_HOLD_MS,
  RANDOM_GAME_REDUCED_MOTION_DURATION_MS,
  RANDOM_GAME_SETTLE_DURATION_MS,
  RANDOM_GAME_STEP_DELAYS_MS,
  RANDOM_GAME_TOTAL_DURATION_MS,
} from "../src/components/randomGame";
import type { Game, StatusId } from "../src/domain/types";

const DATE = "2026-07-19T10:00:00.000Z";

function game(id: string, title: string, status: StatusId): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms: ["PC"],
    tags: [],
    status,
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: DATE,
    updatedAt: DATE,
  };
}

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

const wishlist = game("wishlist", "Outer Wilds", "wishlist");
const playing = game("playing", "Hades", "playing");
const played = game("played", "Disco Elysium", "played");
const completed = game("completed", "Celeste", "completed");
const dropped = game("dropped", "Starfield", "dropped");
const platinum = game("platinum", "Bloodborne", "platinum");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery(false)));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("random game candidates", () => {
  it("keeps wishlist, playing and played games only", () => {
    expect(getRandomGameCandidates([wishlist, completed, playing, dropped, played, platinum]))
      .toEqual([wishlist, playing, played]);
  });

  it("builds the entire reel from eligible real games and settles on the preselected winner", () => {
    const reel = createRandomGameRoll([wishlist, completed, playing, dropped, played, platinum], () => 0.4);

    expect(reel).toHaveLength(RANDOM_GAME_STEP_DELAYS_MS.length + 1);
    expect(reel.at(-1)).toBe(playing);
    expect(reel.every((item) => [wishlist, playing, played].includes(item))).toBe(true);
    expect(reel.at(-2)).not.toBe(playing);
  });
});

describe("RandomGameButton", () => {
  it("spins for several seconds, shows the winner, then opens it", () => {
    const onNavigate = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<RandomGameButton games={[wishlist, completed, playing]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));

    expect(screen.getByRole("status")).toHaveTextContent("Выбираем случайную игру из 2");
    expect(document.querySelectorAll("[data-random-game-slot-id]")).toHaveLength(5);
    expect([...document.querySelectorAll("[data-random-game-slot-id]")].every((item) => [wishlist.id, playing.id].includes(item.getAttribute("data-random-game-slot-id") ?? ""))).toBe(true);
    expect(document.querySelectorAll(".random-game-slot__selection")).toHaveLength(1);
    const reelBeforeStep = document.querySelector(".random-game-slot__reel");
    const nodesBeforeStep = [...document.querySelectorAll("[data-random-game-slot-id]")];
    const beforeStep = [...document.querySelectorAll("[data-random-game-slot-id]")].map((item) => item.getAttribute("data-random-game-slot-id"));
    act(() => { vi.advanceTimersByTime(RANDOM_GAME_STEP_DELAYS_MS[0]); });
    const nodesAfterStep = [...document.querySelectorAll("[data-random-game-slot-id]")];
    const afterStep = [...document.querySelectorAll("[data-random-game-slot-id]")].map((item) => item.getAttribute("data-random-game-slot-id"));
    expect(beforeStep.slice(1)).toEqual(afterStep.slice(0, 4));
    expect(document.querySelector(".random-game-slot__reel")).toBe(reelBeforeStep);
    nodesBeforeStep.slice(1).forEach((node, index) => {
      expect(nodesAfterStep[index]).toBe(node);
    });
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(RANDOM_GAME_TOTAL_DURATION_MS - RANDOM_GAME_FINAL_HOLD_MS - RANDOM_GAME_STEP_DELAYS_MS[0]); });
    expect(screen.getByRole("status")).toHaveTextContent(`Выбрана игра: ${wishlist.title}`);
    expect(document.querySelector("[data-random-game-id]")).toHaveAttribute("data-random-game-id", wishlist.id);
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(RANDOM_GAME_FINAL_HOLD_MS - 1); });
    expect(onNavigate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(`#/games/${wishlist.id}`);
  });

  it("decodes covers before showing the reel and keeps their image nodes mounted", async () => {
    let releaseCovers = () => {};
    const coversReady = new Promise<void>((resolve) => { releaseCovers = resolve; });
    const decode = vi.fn(() => coversReady);
    vi.stubGlobal("Image", class {
      src = "";
      decode = decode;
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const gamesWithCovers = [
      { ...wishlist, coverAssetId: "wishlist-cover" },
      { ...playing, coverAssetId: "playing-cover" },
    ];
    render(
      <RandomGameButton
        games={gamesWithCovers}
        resolveAssetUrl={(assetId) => `data:image/gif;base64,R0lGODlhAQABAAAAACw=#${assetId}`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));
    expect(screen.getByRole("status")).toHaveTextContent("Готовим случайную игру из 2");
    expect(document.querySelector(".random-game-slot")).not.toBeInTheDocument();

    await act(async () => {
      releaseCovers();
      await coversReady;
      await Promise.resolve();
    });

    const beforeImages = new Map(
      [...document.querySelectorAll<HTMLElement>("[data-random-game-reel-index]")].map((item) => [
        item.dataset.randomGameReelIndex ?? "",
        item.querySelector("img"),
      ]),
    );
    act(() => { vi.advanceTimersByTime(RANDOM_GAME_STEP_DELAYS_MS[0]); });
    const afterItems = [...document.querySelectorAll<HTMLElement>("[data-random-game-reel-index]")];
    const retainedImages = afterItems.filter((item) => beforeImages.has(item.dataset.randomGameReelIndex ?? ""));

    expect(decode).toHaveBeenCalledTimes(2);
    expect(retainedImages).toHaveLength(4);
    retainedImages.forEach((item) => {
      expect(item.querySelector("img")).toBe(beforeImages.get(item.dataset.randomGameReelIndex ?? ""));
    });
  });

  it("keeps the final face continuous while slowing down to the winner", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<RandomGameButton games={[wishlist, playing]} />);

    fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));
    const finalStepStartsAt = RANDOM_GAME_STEP_DELAYS_MS.reduce((total, delay) => total + delay, 0);
    act(() => { vi.advanceTimersByTime(finalStepStartsAt - 1); });
    const beforeFinalStep = [...document.querySelectorAll("[data-random-game-slot-id]")]
      .map((item) => item.getAttribute("data-random-game-slot-id"));

    act(() => { vi.advanceTimersByTime(1); });
    const afterFinalStep = [...document.querySelectorAll("[data-random-game-slot-id]")]
      .map((item) => item.getAttribute("data-random-game-slot-id"));
    const reel = document.querySelector<HTMLElement>(".random-game-slot__reel");

    expect(beforeFinalStep.slice(1)).toEqual(afterFinalStep.slice(0, 4));
    expect(document.querySelector(".random-game-slot")).toHaveClass("is-settled");
    expect(document.querySelector("[data-random-game-id]")).toHaveAttribute("data-random-game-id", wishlist.id);
    expect(reel?.style.getPropertyValue("--random-game-step-duration")).toBe(`${RANDOM_GAME_SETTLE_DURATION_MS}ms`);
    expect(RANDOM_GAME_SETTLE_DURATION_MS).toBeGreaterThan(RANDOM_GAME_STEP_DELAYS_MS.at(-1)!);
  });

  it("stays focusable and explains when every game is completed, dropped or platinum", () => {
    const onNavigate = vi.fn();
    render(<RandomGameButton games={[completed, dropped, platinum]} onNavigate={onNavigate} />);

    const button = screen.getByRole("button", { name: "Случайная игра: нет непройденных игр" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    act(() => { vi.advanceTimersByTime(RANDOM_GAME_TOTAL_DURATION_MS); });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("cancels the roll if the eligible game list changes", () => {
    const onNavigate = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const view = render(<RandomGameButton games={[wishlist, playing]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));
    view.rerender(<RandomGameButton games={[{ ...wishlist, status: "completed" }, playing]} onNavigate={onNavigate} />);
    act(() => { vi.advanceTimersByTime(RANDOM_GAME_TOTAL_DURATION_MS); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("cancels the roll with Escape", () => {
    const onNavigate = vi.fn();
    render(<RandomGameButton games={[wishlist, playing]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(RANDOM_GAME_TOTAL_DURATION_MS); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses a real link so the existing unsaved-changes guard can cancel navigation", () => {
    const onNavigate = vi.fn();
    const guard = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", guard, true);
    try {
      vi.spyOn(Math, "random").mockReturnValue(0);
      render(<RandomGameButton games={[wishlist]} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));
      act(() => { vi.advanceTimersByTime(RANDOM_GAME_TOTAL_DURATION_MS); });
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", guard, true);
    }
  });

  it("skips the long reel when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery(true)));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const onNavigate = vi.fn();
    render(<RandomGameButton games={[wishlist, playing]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Случайная игра" }));
    expect(screen.getByRole("status")).toHaveTextContent(`Выбрана игра: ${wishlist.title}`);
    act(() => { vi.advanceTimersByTime(RANDOM_GAME_REDUCED_MOTION_DURATION_MS - 1); });
    expect(onNavigate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onNavigate).toHaveBeenCalledWith(`#/games/${wishlist.id}`);
  });
});
