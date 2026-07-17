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
    games: {},
    notes: {},
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
