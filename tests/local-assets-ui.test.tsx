import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "../src/components/AppShell";
import { DiffDialog } from "../src/components/DiffDialog";
import { GamePage } from "../src/pages/GamePage";

afterEach(cleanup);

describe("local-only storage UI", () => {
  it("keeps storage details and recovery actions inside local changes", async () => {
    const user = userEvent.setup();
    const onOpenDiff = vi.fn();
    const onExport = vi.fn();
    const onFreeSpace = vi.fn();
    const oldestCreatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    render(<>
      <AppShell onOpenDiff={onOpenDiff} route="catalog" storage={{
        bytes: 286 * 1024 * 1024,
        budgetBytes: 400 * 1024 * 1024,
        localAssetCount: 14,
        localAssetBytes: 286 * 1024 * 1024,
        quotaLevel: "critical",
        persistent: false,
        oldestLocalAssetAt: oldestCreatedAt,
        operationCount: 3,
      }}><div>Library</div></AppShell>
      <DiffDialog
        items={[]}
        localAssets={{ bytes: 286 * 1024 * 1024, count: 14, oldestCreatedAt, onFreeSpace, persistent: false, quotaLevel: "critical" }}
        onClose={vi.fn()}
        onExport={onExport}
        onImport={vi.fn()}
        open
        patchBytes={120}
        payload=""
        publishCommand="npm run publish:clipboard"
      />
    </>);

    expect(document.querySelector(".local-assets-status")).not.toBeInTheDocument();
    const localChanges = screen.getByRole("button", { name: /Локальные правки: 3, 286 МБ, локальных файлов: 14/ });
    expect(localChanges).toHaveClass("patch-pill--critical");
    expect(screen.getByText("Только на этом устройстве: 14 файлов, 286 МБ")).toBeInTheDocument();
    expect(screen.getByText(/Браузер не гарантирует постоянное хранение/)).toBeInTheDocument();
    expect(screen.getByText(/Самому старому локальному файлу 8 дн/)).toBeInTheDocument();
    await user.click(localChanges);
    await user.click(screen.getByRole("button", { name: "Экспортировать локальную копию" }));
    await user.click(screen.getByRole("button", { name: "Освободить место" }));
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onFreeSpace).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown zero-state neutral and out of the page layout", () => {
    render(<AppShell onOpenDiff={vi.fn()} route="tiers" storage={{ bytes: 0, localAssetCount: 0, localAssetBytes: 0, quotaLevel: "unknown", persistent: false, operationCount: 0 }}><div>Library</div></AppShell>);
    expect(screen.getByRole("button", { name: "Локальные правки: 0, 0 Б" })).toHaveClass("patch-pill--ok");
    expect(document.querySelector(".local-assets-status")).not.toBeInTheDocument();
    expect(screen.queryByText("Лимит браузера неизвестен")).not.toBeInTheDocument();
    expect(screen.queryByText(/Браузер не гарантирует постоянное хранение/)).not.toBeInTheDocument();
  });

  it("blocks only attachment controls while leaving creation and text editing available", async () => {
    const user = userEvent.setup();
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} storageLocked />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    await user.type(editor, "Текст остаётся редактируемым");
    expect(editor).toHaveValue("Текст остаётся редактируемым");
    expect(screen.getByRole("button", { name: "Добавить вложение" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled();
  });
});
