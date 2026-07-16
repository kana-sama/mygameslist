import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLibrary, type LibraryDatabase } from "../src/domain";

const libraryPath = resolve(process.cwd(), "public/data/library.json");

describe("published library", () => {
  it("starts as a valid pristine empty database", () => {
    const database = JSON.parse(readFileSync(libraryPath, "utf8")) as LibraryDatabase;

    expect(validateLibrary(database).ok).toBe(true);
    expect(database).toEqual({
      schemaVersion: 2,
      revision: "",
      publicationId: null,
      games: {},
      notes: {},
      assets: {},
    });
  });
});
