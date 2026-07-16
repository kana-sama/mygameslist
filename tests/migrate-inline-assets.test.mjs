import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateInlineAssets } from "../scripts/migrate-inline-assets.mjs";
import { computeRevision, validateLibrary } from "../scripts/validate-data.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("inline asset migration", () => {
  it("moves static base64 into a content-addressed WebP file and is idempotent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-inline-assets-"));
    roots.push(root);
    const dataRoot = path.join(root, "public", "data");
    mkdirSync(dataRoot, { recursive: true });
    const bytes = Buffer.from("RIFFxxxxWEBPsynthetic");
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
          mime: "image/webp",
          width: 1,
          height: 1,
          base64: bytes.toString("base64"),
          alt: "Synthetic cover",
          originalName: "cover.png",
        },
      },
    };
    database.revision = computeRevision(database);
    writeFileSync(path.join(dataRoot, "library.json"), `${JSON.stringify(database, null, 2)}\n`);

    expect(migrateInlineAssets(root)).toEqual({ migrated: 1, mediaPaths: [`public/media/${id}.webp`] });
    const published = JSON.parse(readFileSync(path.join(dataRoot, "library.json"), "utf8"));
    expect(published.assets[id]).toEqual({
      id,
      kind: "image",
      mime: "image/webp",
      width: 1,
      height: 1,
      byteLength: bytes.byteLength,
      alt: "Synthetic cover",
      originalName: "cover.png",
    });
    expect(readFileSync(path.join(root, "public", "media", `${id}.webp`))).toEqual(bytes);
    expect(() => validateLibrary(published, { mediaRoot: path.join(root, "public", "media") })).not.toThrow();
    expect(migrateInlineAssets(root)).toEqual({ migrated: 0, mediaPaths: [] });
  });
});
