import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MAX_WEBP_DIMENSION, computeRevision, validateLibrary } from "../scripts/validate-data.mjs";

function databaseWithImage(width, height) {
  const bytes = Buffer.from("RIFFxxxxWEBPdimension-fixture");
  const id = createHash("sha256").update(bytes).digest("hex");
  const database = {
    schemaVersion: 2,
    revision: "",
    publicationId: "11111111-1111-4111-8111-111111111111",
    games: {
      "22222222-2222-4222-8222-222222222222": {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Map",
        coverAssetId: null,
        platforms: [],
        tags: [],
        status: "wishlist",
        placement: { tierId: "unranked", rank: 1024 },
        reviewMarkdown: "",
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    },
    notes: {
      "33333333-3333-4333-8333-333333333333": {
        id: "33333333-3333-4333-8333-333333333333",
        gameId: "22222222-2222-4222-8222-222222222222",
        bodyMarkdown: "",
        attachments: [{ type: "image", assetId: id, alt: "Map" }],
        rank: 1024,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    },
    assets: {
      [id]: {
        id,
        kind: "image",
        mime: "image/webp",
        width,
        height,
        byteLength: bytes.byteLength,
        alt: "Synthetic map",
        originalName: "map.png",
      },
    },
  };
  database.revision = computeRevision(database);
  return database;
}

describe("published note image dimensions", () => {
  it("accepts original resolutions above 1280 px up to the WebP format limit", () => {
    expect(() => validateLibrary(databaseWithImage(420, 3072))).not.toThrow();
    expect(() => validateLibrary(databaseWithImage(420, MAX_WEBP_DIMENSION + 1))).toThrow(/height.*1 through 16383/);
  });
});
