import { describe, expect, it } from "vitest";
import { computeRevision, validateLibrary } from "../scripts/validate-data.mjs";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-17T04:00:00.000Z";

describe("published platinum status", () => {
  it("is accepted by the standalone data validator", () => {
    const database = {
      schemaVersion: 2,
      revision: "",
      publicationId: "22222222-2222-4222-8222-222222222222",
      games: {
        [GAME_ID]: {
          id: GAME_ID,
          title: "Synthetic platinum game",
          coverAssetId: null,
          platforms: [],
          tags: [],
          status: "platinum",
          placement: { tierId: "s", rank: 1024 },
          reviewMarkdown: "",
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      notes: {},
      assets: {},
    };
    database.revision = computeRevision(database);

    expect(() => validateLibrary(database)).not.toThrow();
  });
});
