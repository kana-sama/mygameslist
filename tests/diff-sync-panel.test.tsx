import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffDialog, type DiffSelectionState } from "../src/components/DiffDialog";
import type { DiffSyncController } from "../src/components/DiffSyncPanel";
import type { ChangeReviewModel, ReviewChange } from "../src/domain";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const operationPath = `/games/${GAME_ID}/title`;
const unrelatedOperationPath = `/games/${GAME_ID}/reviewMarkdown`;
const change: ReviewChange = {
  id: "game-title-row",
  selectionId: "game-title",
  entity: { map: "games", id: GAME_ID },
  kind: "changed",
  title: "DuckTales",
  summary: "Название: DuckTales → DuckTales Remastered",
  changedAt: "2026-08-04T12:00:00.000Z",
  operationPaths: [operationPath, unrelatedOperationPath],
  gameIds: [GAME_ID],
  evidence: [{ type: "scalar", before: "DuckTales", after: "DuckTales Remastered" }],
};
const review: ChangeReviewModel = {
  groups: [{ id: `game:${GAME_ID}`, gameId: GAME_ID, title: "DuckTales", coverAssetId: null, newestChangedAt: change.changedAt, changes: [change] }],
  changesById: { [change.id]: change },
  changesBySelectionId: { [change.selectionId]: [change] },
  uniqueSelectionIds: [change.selectionId],
};
const emptyReview: ChangeReviewModel = { groups: [], changesById: {}, changesBySelectionId: {}, uniqueSelectionIds: [] };
const emptySelection: DiffSelectionState = {
  enabled: false,
  explicitSelectionIds: new Set(),
  selectedSelectionIds: new Set(),
  dependencySelectionIds: new Set(),
  dependencyLabels: {},
};
const partialSelection: DiffSelectionState = {
  enabled: true,
  explicitSelectionIds: new Set([change.selectionId]),
  selectedSelectionIds: new Set([change.selectionId]),
  dependencySelectionIds: new Set(),
  dependencyLabels: {},
  selectedPaths: [operationPath],
};

function renderDialog(
  sync: DiffSyncController,
  model: ChangeReviewModel = review,
  conflicts: Parameters<typeof DiffDialog>[0]["conflicts"] = [],
  selection: DiffSelectionState = emptySelection,
) {
  return render(
    <DiffDialog
      conflicts={conflicts}
      onClose={vi.fn()}
      onEnterSelection={vi.fn()}
      onExport={vi.fn()}
      onImport={vi.fn()}
      onToggleChange={vi.fn()}
      onToggleGame={vi.fn()}
      open
      patchBytes={1024}
      review={model}
      selection={selection}
      sync={sync}
    />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("DiffDialog GitHub sync shell", () => {
  it("opens an inline password form and forwards PAT and remember choice", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderDialog({ busy: false, connected: false, error: null, onConnect, onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: false, patCreationHref: "https://github.com/settings/personal-access-tokens/new", persistence: "none", repository: "kana/mylib", stage: "idle" });

    await user.click(screen.getByRole("button", { name: "Синхронизировать всё" }));
    expect(screen.getByRole("region", { name: "Синхронизация с GitHub" })).toBeInTheDocument();
    expect(screen.getByText("kana/mylib")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Создать fine-grained PAT" })).toHaveAttribute("href", "https://github.com/settings/personal-access-tokens/new");

    const input = screen.getByLabelText("Fine-grained PAT");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("name", "github-fine-grained-pat");
    await user.type(input, "github_pat_secret");
    expect(screen.getByRole("checkbox", { name: "Запомнить PAT на этом устройстве" })).not.toBeChecked();
    expect(screen.getByText(/сразу создаст коммит в main/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Подключить и синхронизировать" }));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith("github_pat_secret", false, undefined));
    await waitFor(() => expect(screen.getByLabelText("Fine-grained PAT")).toHaveValue(""));
  });

  it("connects without synchronization when there are no local changes", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderDialog({ busy: false, connected: false, connectMode: "verify", error: null, onConnect, onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: false, persistence: "none", stage: "idle" }, emptyReview);

    await user.click(screen.getByRole("button", { name: "Синхронизировать всё" }));
    const panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    expect(within(panel).queryByText("Нет локальных изменений для синхронизации.")).not.toBeInTheDocument();
    expect(within(panel).getByText(/отдельную временную ветку/)).toHaveTextContent("Ветка main не изменится");
    await user.type(within(panel).getByLabelText("Fine-grained PAT"), "github_pat_secret");
    const connect = within(panel).getByRole("button", { name: "Подключить" });
    expect(connect).toBeEnabled();
    expect(within(panel).queryByRole("button", { name: "Подключить и синхронизировать" })).not.toBeInTheDocument();
    await user.click(connect);

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith("github_pat_secret", false, undefined));
  });

  it("syncs or disconnects a saved PAT without rendering it", async () => {
    const user = userEvent.setup();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    renderDialog({ busy: false, connected: true, error: null, onConnect: vi.fn(), onDisconnect, onSync, pagesPending: false, persistence: "persistent", stage: "idle" });

    await user.click(screen.getByRole("button", { name: "Синхронизировать всё" }));
    expect(screen.queryByLabelText("Fine-grained PAT")).not.toBeInTheDocument();
    expect(screen.getByText("PAT сохранён на этом устройстве")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Синхронизировать всё" })[1]);
    await waitFor(() => expect(onSync).toHaveBeenCalledWith(undefined));

    await user.click(screen.getByRole("button", { name: "Отключить" }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
  });

  it("always opens the panel but blocks only its submit action for an empty patch or conflicts", async () => {
    const user = userEvent.setup();
    const sync: DiffSyncController = { busy: false, connected: true, error: null, onConnect: vi.fn(), onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: false, persistence: "session", stage: "idle" };
    const { rerender } = renderDialog(sync, emptyReview);
    const toggle = screen.getByRole("button", { name: "Синхронизировать всё" });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    let panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    expect(within(panel).getByRole("button", { name: "Синхронизировать всё" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Отключить" })).toBeEnabled();
    expect(within(panel).getByText("Нет локальных изменений для синхронизации.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Синхронизировать всё" })[0]);

    rerender(
      <DiffDialog
        conflicts={[{ id: "conflict", label: "Название", localValue: "Local", path: operationPath, staticValue: "Static" }]}
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        open
        patchBytes={1024}
        review={review}
        selection={partialSelection}
        sync={sync}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Синхронизировать выбранное · 1" }));
    panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    expect(screen.getAllByRole("button", { name: "Синхронизировать выбранное · 1" })[0]).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "Синхронизировать выбранное · 1" })).toBeDisabled();
    expect(within(panel).getByText("Сначала разрешите все конфликты.")).toBeInTheDocument();
  });

  it("blocks an empty pending publication and enables another sync when a later edit appears", async () => {
    const user = userEvent.setup();
    const sync: DiffSyncController = { busy: false, connected: true, error: null, onConnect: vi.fn(), onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: true, persistence: "session", stage: "complete" };
    const { rerender } = renderDialog(sync, emptyReview);

    await user.click(screen.getByRole("button", { name: "Синхронизировать всё" }));
    let panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    expect(within(panel).getByRole("button", { name: "Синхронизировать всё" })).toBeDisabled();
    expect(within(panel).getByRole("status")).toHaveTextContent("Ждём обновления GitHub Pages");

    rerender(
      <DiffDialog
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        open
        patchBytes={1024}
        review={review}
        selection={emptySelection}
        sync={sync}
      />,
    );
    panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    expect(within(panel).getByRole("button", { name: "Синхронизировать всё" })).toBeEnabled();
  });

  it("clears a local error and asks the controller to clear its error", async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();
    const onSync = vi.fn().mockRejectedValue(new Error("Локальная ошибка"));
    renderDialog({ busy: false, connected: true, error: null, onConnect: vi.fn(), onDisconnect: vi.fn(), onDismissError, onSync, pagesPending: false, persistence: "session", stage: "idle" });

    await user.click(screen.getByRole("button", { name: "Синхронизировать всё" }));
    const panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    await user.click(within(panel).getByRole("button", { name: "Синхронизировать всё" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Локальная ошибка");
    await user.click(within(panel).getByRole("button", { name: "Скрыть" }));

    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
    expect(onDismissError).toHaveBeenCalledTimes(2);
  });

  it("restores focus to the header toggle when the panel close button is used", async () => {
    const user = userEvent.setup();
    renderDialog({ busy: false, connected: false, error: null, onConnect: vi.fn(), onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: false, persistence: "none", stage: "idle" });
    const toggle = screen.getByRole("button", { name: "Синхронизировать всё" });
    await user.click(toggle);
    const panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    await waitFor(() => expect(within(panel).getByLabelText("Fine-grained PAT")).toHaveFocus());
    await user.click(within(panel).getByRole("button", { name: "Закрыть синхронизацию" }));

    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.queryByRole("region", { name: "Синхронизация с GitHub" })).not.toBeInTheDocument();
  });

  it("does not expose the removed local publication fallback", () => {
    renderDialog({
      busy: false,
      connected: true,
      error: null,
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onSync: vi.fn(),
      pagesPending: false,
      persistence: "session",
      stage: "idle",
    });

    expect(screen.queryByText("Локальная публикация")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Скопировать патч" })).not.toBeInTheDocument();
    expect(screen.queryByText("npm run publish:clipboard")).not.toBeInTheDocument();
  });

  it("shows progress and failures inline and never as a toast", async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();
    const base = { connected: true, onConnect: vi.fn(), onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: false, persistence: "session" as const };
    const { rerender } = renderDialog({ ...base, busy: false, error: null, onDismissError, stage: "idle" });
    await user.click(screen.getByRole("button", { name: "Синхронизировать всё" }));

    rerender(
      <DiffDialog
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        open
        patchBytes={1024}
        review={review}
        selection={emptySelection}
        sync={{ ...base, busy: true, error: "GitHub вернул 409", onDismissError, stage: "committing" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Синхронизация…" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Создаём коммит…");
    expect(screen.getByRole("alert")).toHaveTextContent("GitHub вернул 409");
    await user.click(screen.getByRole("button", { name: "Скрыть" }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("freezes a partial operation scope for saved-PAT and connect-and-sync actions", async () => {
    const user = userEvent.setup();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const saved = renderDialog({ busy: false, connected: true, error: null, onConnect: vi.fn(), onDisconnect: vi.fn(), onSync, pagesPending: false, persistence: "session", stage: "idle" }, review, [], partialSelection);

    await user.click(screen.getByRole("button", { name: "Синхронизировать выбранное · 1" }));
    await user.click(within(screen.getByRole("region", { name: "Синхронизация с GitHub" })).getByRole("button", { name: "Синхронизировать выбранное · 1" }));
    await waitFor(() => expect(onSync).toHaveBeenCalledWith([operationPath]));

    saved.unmount();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderDialog({ busy: false, connected: false, error: null, onConnect, onDisconnect: vi.fn(), onSync: vi.fn(), pagesPending: false, persistence: "none", stage: "idle" }, review, [], partialSelection);
    await user.click(screen.getByRole("button", { name: "Синхронизировать выбранное · 1" }));
    await user.type(screen.getByLabelText("Fine-grained PAT"), "github_pat_secret");
    await user.click(screen.getByRole("button", { name: "Подключить и синхронизировать" }));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith("github_pat_secret", false, [operationPath]));
  });

  it("drops a completed frozen scope before another saved-PAT sync", async () => {
    const user = userEvent.setup();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const controller: DiffSyncController = { busy: false, connected: true, error: null, onConnect: vi.fn(), onDisconnect: vi.fn(), onSync, pagesPending: false, persistence: "session", stage: "idle" };
    const { rerender } = renderDialog(controller, review, [], partialSelection);
    await user.click(screen.getByRole("button", { name: "Синхронизировать выбранное · 1" }));

    rerender(
      <DiffDialog
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        open
        patchBytes={1024}
        review={review}
        selection={emptySelection}
        sync={{ ...controller, stage: "complete" }}
      />,
    );

    const panel = screen.getByRole("region", { name: "Синхронизация с GitHub" });
    await user.click(await within(panel).findByRole("button", { name: "Синхронизировать всё" }));
    await waitFor(() => expect(onSync).toHaveBeenCalledWith(undefined));
  });
});
