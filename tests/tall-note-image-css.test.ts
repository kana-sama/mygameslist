import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("note media previews", () => {
  it("uses one contained preview height instead of inline tall-image expansion", () => {
    const preview = /\.note-attachment-shell--image, \.note-attachment-shell--youtube, \.note-attachment-shell--video\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    const image = /\.note-attachment--image img\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    const youtube = /\.note-attachment--youtube\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";

    expect(preview).toContain("height: 260px");
    expect(image).toContain("object-fit: contain");
    expect(youtube).toContain("aspect-ratio: 16 / 9");
    expect(youtube).toContain("max-width: 462.222px");
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.note-attachment-shell--image, \.note-attachment-shell--youtube, \.note-attachment-shell--video \{ height:\s*220px;/);
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.note-attachment--youtube \{ max-width:\s*391\.111px;/);
    expect(styles).not.toContain("note-attachment-shell--tall-image");
    expect(styles).not.toContain("note-attachment-tall-toggle");
  });
});
