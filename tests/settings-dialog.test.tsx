import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../src/components/SettingsDialog";

function renderDialog(overrides: Partial<ComponentProps<typeof SettingsDialog>> = {}) {
  const callbacks = {
    onClose: vi.fn(),
    onCompletedChecklistFilterEnabledChange: vi.fn(),
    onPinchZoomBlockedChange: vi.fn(),
    onSidebarLayoutModeChange: vi.fn(),
  };
  const view = render(<><button type="button">Открыть</button><SettingsDialog
    completedChecklistFilterEnabled={false}
    open
    pinchZoomBlocked={false}
    sidebarLayoutMode="side"
    {...callbacks}
    {...overrides}
  /></>);
  return { ...view, ...callbacks };
}

describe("SettingsDialog", () => {
  it("renders the approved copy, exactly two layout cards, and two unlabeled switches", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Настройки" });
    expect(within(dialog).getByText("Действуют для всей библиотеки, хранятся только в этом браузере и не синхронизируются.")).toBeVisible();
    expect(within(dialog).getByText("Расположение обложки и сведений")).toBeVisible();
    expect(within(dialog).getByText("Выберите, где располагать панель с обложкой, сведениями об игре и кнопкой удаления.")).toBeVisible();
    expect(within(dialog).getByText("Компактная боковая панель")).toBeVisible();
    expect(within(dialog).getByText("Больше места для заметок")).toBeVisible();
    expect(within(dialog).getByText("В чеклистах будут видны только незавершённые пункты. Выполненные всегда можно временно раскрыть в самой заметке.")).toBeVisible();
    expect(within(dialog).getByText("Safari иногда смещает область наведения и клика после изменения масштаба двумя пальцами. Эта настройка отключает такой жест на трекпаде и помогает избежать ошибки.")).toBeVisible();
    expect(within(dialog).getByText("Изменение масштаба через меню Safari и сочетания клавиш ⌘+ и ⌘− продолжит работать.")).toBeVisible();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(within(dialog).getByRole("radio", { name: "Слева" }).closest(".settings-layout-option")?.querySelector(".settings-layout-skeleton")).not.toBeNull();
    expect(within(dialog).getByRole("radio", { name: "Сверху" }).closest(".settings-layout-option")?.querySelector(".settings-layout-skeleton")).not.toBeNull();
    expect(within(dialog).getAllByRole("switch")).toHaveLength(2);
    expect(within(dialog).getByRole("switch", { name: "Скрывать выполненные пункты" })).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "Отключить масштабирование жестом" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Скрывать выполненные")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Блокировать pinch")).not.toBeInTheDocument();
  });

  it("applies explicit preference callbacks immediately", async () => {
    const user = userEvent.setup();
    const { onCompletedChecklistFilterEnabledChange, onPinchZoomBlockedChange, onSidebarLayoutModeChange } = renderDialog();

    await user.click(screen.getByRole("radio", { name: "Сверху" }));
    await user.click(screen.getByRole("switch", { name: "Скрывать выполненные пункты" }));
    await user.click(screen.getByRole("switch", { name: "Отключить масштабирование жестом" }));

    expect(onSidebarLayoutModeChange).toHaveBeenCalledTimes(1);
    expect(onSidebarLayoutModeChange).toHaveBeenCalledWith("top");
    expect(onCompletedChecklistFilterEnabledChange).toHaveBeenCalledWith(true);
    expect(onPinchZoomBlockedChange).toHaveBeenCalledWith(true);
  });

  it("closes from every explicit close action and restores focus to the opener", async () => {
    const user = userEvent.setup();
    const { onClose, rerender } = renderDialog({ open: false });
    const opener = screen.getByRole("button", { name: "Открыть" });
    opener.focus();
    rerender(<><button type="button">Открыть</button><SettingsDialog completedChecklistFilterEnabled={false} onClose={onClose} onCompletedChecklistFilterEnabledChange={vi.fn()} onPinchZoomBlockedChange={vi.fn()} onSidebarLayoutModeChange={vi.fn()} open pinchZoomBlocked={false} sidebarLayoutMode="side" /></>);

    await waitFor(() => expect(document.activeElement).not.toBe(opener));
    await user.click(screen.getByRole("button", { name: "Закрыть настройки" }));
    await user.click(screen.getByRole("button", { name: "Готово" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.querySelector(".settings-dialog-layer")!);
    expect(onClose).toHaveBeenCalledTimes(4);

    rerender(<><button type="button">Открыть</button><SettingsDialog completedChecklistFilterEnabled={false} onClose={onClose} onCompletedChecklistFilterEnabledChange={vi.fn()} onPinchZoomBlockedChange={vi.fn()} onSidebarLayoutModeChange={vi.fn()} open={false} pinchZoomBlocked={false} sidebarLayoutMode="side" /></>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Открыть" }));
  });

  it("keeps a closing settings layer until its exit lifecycle completes", () => {
    vi.useFakeTimers();
    try {
      const { onClose, onCompletedChecklistFilterEnabledChange, onPinchZoomBlockedChange, onSidebarLayoutModeChange, rerender } = renderDialog({ open: false });
      const opener = screen.getByRole("button", { name: "Открыть" });
      opener.focus();

      rerender(<><button type="button">Открыть</button><SettingsDialog completedChecklistFilterEnabled={false} onClose={onClose} onCompletedChecklistFilterEnabledChange={onCompletedChecklistFilterEnabledChange} onPinchZoomBlockedChange={onPinchZoomBlockedChange} onSidebarLayoutModeChange={onSidebarLayoutModeChange} open pinchZoomBlocked={false} sidebarLayoutMode="side" /></>);
      expect(document.querySelector(".settings-dialog-layer")).toHaveAttribute("data-state", "open");
      rerender(<><button type="button">Открыть</button><SettingsDialog completedChecklistFilterEnabled={false} onClose={onClose} onCompletedChecklistFilterEnabledChange={onCompletedChecklistFilterEnabledChange} onPinchZoomBlockedChange={onPinchZoomBlockedChange} onSidebarLayoutModeChange={onSidebarLayoutModeChange} open={false} pinchZoomBlocked={false} sidebarLayoutMode="side" /></>);

      const layer = document.querySelector(".settings-dialog-layer");
      expect(layer).toHaveAttribute("data-state", "closing");
      expect(layer).toHaveAttribute("aria-hidden", "true");
      expect(layer).toHaveAttribute("inert", "");
      expect(screen.queryByRole("dialog", { name: "Настройки" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);
      expect(within(layer as HTMLElement).queryByRole("button", { name: "Закрыть настройки" })).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(onSidebarLayoutModeChange).not.toHaveBeenCalled();
      expect(onCompletedChecklistFilterEnabledChange).not.toHaveBeenCalled();
      expect(onPinchZoomBlockedChange).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(171));

      expect(document.querySelector(".settings-dialog-layer")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps focus on the opener when closing preempts scheduled dialog focus", () => {
    let pendingFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      pendingFrame = undefined;
    });
    try {
      const { rerender } = renderDialog({ open: false });
      const opener = screen.getByRole("button", { name: "Открыть" });
      opener.focus();

      rerender(<><button type="button">Открыть</button><SettingsDialog completedChecklistFilterEnabled={false} onClose={vi.fn()} onCompletedChecklistFilterEnabledChange={vi.fn()} onPinchZoomBlockedChange={vi.fn()} onSidebarLayoutModeChange={vi.fn()} open pinchZoomBlocked={false} sidebarLayoutMode="side" /></>);

      rerender(<><button type="button">Открыть</button><SettingsDialog completedChecklistFilterEnabled={false} onClose={vi.fn()} onCompletedChecklistFilterEnabledChange={vi.fn()} onPinchZoomBlockedChange={vi.fn()} onSidebarLayoutModeChange={vi.fn()} open={false} pinchZoomBlocked={false} sidebarLayoutMode="side" /></>);
      act(() => pendingFrame?.(performance.now()));

      expect(document.activeElement).toBe(opener);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("traps Tab navigation inside the open dialog", async () => {
    const user = userEvent.setup();
    renderDialog();
    const close = screen.getByRole("button", { name: "Закрыть настройки" });
    const done = screen.getByRole("button", { name: "Готово" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    done.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(done);
  });
});
