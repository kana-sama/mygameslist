import { afterEach, describe, expect, it } from "vitest";
import { smartNoteBackground } from "../src/components/smart/smartNoteBackground";

afterEach(() => document.body.replaceChildren());
function page(html: string, background?: string) {
  const root = document.createElement("div"); root.innerHTML = html;
  if (background) root.style.backgroundColor = background;
  document.body.append(root); return root;
}

describe("smart note outer page background", () => {
  it.each(["rgb(20, 40, 60)", "rgba(80, 30, 100, 0.4)"])("preserves the authored root color %s including alpha", color => {
    const root = page('<button style="background: red">Action</button>', color);
    expect(smartNoteBackground(root)).toBe(color);
  });

  it("follows the sole outer wrapper through transparency and ignores stylesheet and hidden siblings", () => {
    const root = page('<style>.unused{color:red}</style><link rel="stylesheet"><div hidden>Hidden</div><div style="display: none">Hidden</div><section><div style="background: rgb(60, 100, 40)"><button style="background: red">Action</button><p>Text</p></div></section>');
    expect(smartNoteBackground(root)).toBe("rgb(60, 100, 40)");
  });

  it("does not mistake backgrounds on controls or separate content regions for the page surface", () => {
    expect(smartNoteBackground(page('<button style="background: red">Action</button>'))).toBeNull();
    expect(smartNoteBackground(page('<section style="background: red"></section><aside style="background: blue"></aside>'))).toBeNull();
    expect(smartNoteBackground(page('<svg></svg><section style="background: red"></section>'))).toBeNull();
    expect(smartNoteBackground(page('Text<section style="background: red"></section>'))).toBeNull();
  });

  it("keeps the shell fallback for transparent pages and skips non-painting display-contents wrappers", () => {
    expect(smartNoteBackground(page('<section style="background: rgba(100, 80, 60, 0)"><p>Text</p></section>'))).toBeNull();
    const root = page('<div style="display: contents; background: red"><main style="background: rgb(40, 60, 100)">Text</main></div>');
    expect(smartNoteBackground(root)).toBe("rgb(40, 60, 100)");
  });

  it("reads computed class backgrounds again after a theme changes", () => {
    const root = page('<style>.first { background-color: rgb(30, 60, 90); } .second { background-color: rgb(90, 60, 30); }</style><section class="first">Text</section>');
    expect(smartNoteBackground(root)).toBe("rgb(30, 60, 90)");
    root.querySelector("section")!.className = "second";
    expect(smartNoteBackground(root)).toBe("rgb(90, 60, 30)");
  });
});
