// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildCommitMessage } from "../src/shared/commitMessage.js";

const GAME_ID = "00000000-0000-4000-8000-000000000001";
const CELESTE_ID = "00000000-0000-4000-8000-000000000003";
const CONTRA_ID = "00000000-0000-4000-8000-000000000004";
const CELESTE_NOTE_ID = "00000000-0000-4000-8000-000000000005";
const CONTRA_NOTE_ID = "00000000-0000-4000-8000-000000000006";
const DUCKTALES_NOTE_ID = "00000000-0000-4000-8000-000000000007";
const NOW = "2026-07-16T06:00:00.000Z";

function emptyDatabase() {
  return {
    schemaVersion: 2,
    revision: "",
    publicationId: null,
    games: {},
    notes: {},
    assets: {},
  };
}

function game(overrides = {}) {
  return {
    id: GAME_ID,
    title: "DuckTales",
    coverAssetId: null,
    platforms: ["NES"],
    tags: ["platformer"],
    status: "playing",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "Сложная, но честная игра.",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function note(id: string, gameId: string, bodyMarkdown: string, overrides = {}) {
  return {
    id,
    gameId,
    bodyMarkdown,
    attachments: [],
    rank: 1024,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function asset(id: string, originalName: string, overrides = {}) {
  return {
    id,
    kind: "image",
    mime: "image/webp",
    width: 1,
    height: 1,
    byteLength: 12,
    alt: "",
    originalName,
    ...overrides,
  };
}

describe("semantic publication commit messages", () => {
  it("describes only the selected result when another game remains deferred", () => {
    const before = emptyDatabase();
    before.games[GAME_ID] = game({ title: "DuckTales" });
    before.games[CONTRA_ID] = game({ id: CONTRA_ID, title: "Contra" });
    const selectedResult = structuredClone(before);
    selectedResult.games[GAME_ID].title = "DuckTales Remastered";

    const result = buildCommitMessage(before, selectedResult);

    expect(result.subject).toBe("Update DuckTales Remastered");
    expect(result.body).toContain('Update "DuckTales" -> "DuckTales Remastered": title');
    expect(result.message).not.toContain("Contra");
  });

  it("builds a dynamic subject and a semantic body without embedding image data", () => {
    const celesteAssetId = "a".repeat(64);
    const contraAssetId = "b".repeat(64);
    const ducktalesAssetId = "c".repeat(64);
    const before = emptyDatabase();
    before.games[CELESTE_ID] = game({
      id: CELESTE_ID,
      title: "Celeste",
      coverAssetId: celesteAssetId,
      tags: ["platformer"],
      placement: { tierId: "b", rank: 1024 },
    });
    before.games[CONTRA_ID] = game({ id: CONTRA_ID, title: "Contra", coverAssetId: contraAssetId });
    before.notes[CELESTE_NOTE_ID] = note(CELESTE_NOTE_ID, CELESTE_ID, "Climb carefully");
    before.notes[CONTRA_NOTE_ID] = note(CONTRA_NOTE_ID, CONTRA_ID, "Secret path");
    before.assets[celesteAssetId] = asset(celesteAssetId, "celeste.webp", { alt: "Celeste cover" });
    before.assets[contraAssetId] = asset(contraAssetId, "contra.webp");

    const after = structuredClone(before);
    after.games[CELESTE_ID] = {
      ...after.games[CELESTE_ID],
      title: "Celeste Classic",
      tags: ["platformer", "precision"],
      status: "completed",
      placement: { tierId: "a", rank: 1024 },
    };
    delete after.games[CONTRA_ID];
    after.games[GAME_ID] = game({ coverAssetId: ducktalesAssetId });
    after.notes[CELESTE_NOTE_ID] = {
      ...after.notes[CELESTE_NOTE_ID],
      bodyMarkdown: "Take the hidden route",
      attachments: [{ type: "link", url: "https://example.com/route", label: "Route" }],
      groupRank: 2048,
    };
    delete after.notes[CONTRA_NOTE_ID];
    after.notes[DUCKTALES_NOTE_ID] = note(DUCKTALES_NOTE_ID, GAME_ID, "Boss route");
    after.assets[celesteAssetId] = { ...after.assets[celesteAssetId], alt: "Celeste Classic cover" };
    delete after.assets[contraAssetId];
    after.assets[ducktalesAssetId] = asset(ducktalesAssetId, "ducktales.webp");

    const result = buildCommitMessage(before, after);
    expect(result).toEqual({
      subject: "Update Celeste Classic, Contra, DuckTales",
      body: `Games:
- Add "DuckTales"
- Update "Celeste" -> "Celeste Classic": title, tags, status playing -> completed, tier B -> A
- Remove "Contra"

Notes:
- Add note for "DuckTales" ("Boss route")
- Update note for "Celeste Classic" ("Take the hidden route"): text, attachments, group
- Remove note from "Contra" ("Secret path")

Images:
- Add "ducktales.webp" (1×1, 12 B)
- Update "celeste.webp": alt text
- Remove "contra.webp" (1×1, 12 B)`,
      message: `Update Celeste Classic, Contra, DuckTales

Games:
- Add "DuckTales"
- Update "Celeste" -> "Celeste Classic": title, tags, status playing -> completed, tier B -> A
- Remove "Contra"

Notes:
- Add note for "DuckTales" ("Boss route")
- Update note for "Celeste Classic" ("Take the hidden route"): text, attachments, group
- Remove note from "Contra" ("Secret path")

Images:
- Add "ducktales.webp" (1×1, 12 B)
- Update "celeste.webp": alt text
- Remove "contra.webp" (1×1, 12 B)`,
    });
    expect(after.assets[ducktalesAssetId]).not.toHaveProperty("base64");
  });

  it("reports collapsed checklist sections as collapsed checklists", () => {
    const before = emptyDatabase();
    before.games[GAME_ID] = game();
    before.notes[DUCKTALES_NOTE_ID] = note(DUCKTALES_NOTE_ID, GAME_ID, "# Route\n- [ ] Task");
    const after = structuredClone(before);
    after.notes[DUCKTALES_NOTE_ID].collapsedChecklistSections = ["heading:abc", "group:def"];

    expect(buildCommitMessage(before, after).body).toContain("collapsed checklists");
  });

  it("bounds and sanitizes commit messages for large patches", () => {
    const before = emptyDatabase();
    const after = emptyDatabase();
    for (let index = 0; index < 25; index += 1) {
      const id = `game-${String(index).padStart(2, "0")}`;
      after.games[id] = game({
        id,
        title: `Game ${index} with a deliberately long title\nthat cannot inject a commit paragraph`,
      });
    }

    const result = buildCommitMessage(before, after);
    expect(Array.from(result.subject)).toHaveLength(result.subject.length);
    expect(Array.from(result.subject).length).toBeLessThanOrEqual(72);
    expect(result.subject).not.toMatch(/[\r\n]/);
    expect(result.subject).toMatch(/\+\d+ games$/);
    expect(result.body.match(/^- Add /gm)).toHaveLength(20);
    expect(result.body).toContain("- ... 5 more game changes");
    expect(result.message.length).toBeLessThan(10_000);

    const unicodeAfter = emptyDatabase();
    unicodeAfter.games[GAME_ID] = game({ title: "🎮".repeat(100) });
    const unicode = buildCommitMessage(emptyDatabase(), unicodeAfter);
    expect(Array.from(unicode.subject).length).toBeLessThanOrEqual(72);
    expect(unicode.subject).not.toContain("�");
  });

  it("bounds note details and prevents Markdown from injecting commit paragraphs", () => {
    const before = emptyDatabase();
    before.games[GAME_ID] = game();
    const after = structuredClone(before);
    for (let index = 0; index < 25; index += 1) {
      const id = `note-${String(index).padStart(2, "0")}`;
      after.notes[id] = note(id, GAME_ID, `Route ${index}\nInjected paragraph ${"x".repeat(2_000)}`);
    }

    const result = buildCommitMessage(before, after);
    expect(result.subject).toBe("Update DuckTales");
    expect(result.body.match(/^- Add note /gm)).toHaveLength(20);
    expect(result.body).toContain("- ... 5 more note changes");
    expect(result.body).not.toContain("\nInjected paragraph");
    expect(result.message.length).toBeLessThan(10_000);
  });
});
