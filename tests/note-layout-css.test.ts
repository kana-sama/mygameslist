import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  document.head.querySelectorAll("style[data-note-layout-test]").forEach((style) => style.remove());
  document.body.replaceChildren();
});

describe("note column layout", () => {
  it("lets rendered and editing note columns shrink to 350px before wrapping", () => {
    const style = document.createElement("style");
    style.dataset.noteLayoutTest = "true";
    style.textContent = productionStyles;
    document.head.append(style);

    for (const className of ["notes-list", "note-editors-grid"]) {
      const grid = document.createElement("div");
      grid.className = className;
      document.body.append(grid);
      expect(getComputedStyle(grid).getPropertyValue("--note-column-min").trim()).toBe("350px");
    }
  });

  it("contains wide rendered tables while keeping heading totals visible", () => {
    const style = document.createElement("style");
    style.dataset.noteLayoutTest = "true";
    style.textContent = productionStyles;
    document.head.append(style);

    const text = document.createElement("div");
    text.className = "note-card__text";
    text.innerHTML = `
      <div class="note-card__viewport-frame">
        <div class="markdown-table-scroll"><table class="markdown-table"><tbody><tr><td>Wide table value</td></tr></tbody></table></div>
      </div>
      <h2 class="markdown-checklist-heading">
        <span class="markdown-checklist-heading__title">A title that yields inline space</span>
        <span class="markdown-checklist-progress">51/85</span>
      </h2>
    `;
    document.body.append(text);

    const frame = text.querySelector<HTMLElement>(".note-card__viewport-frame")!;
    const tableScroll = text.querySelector<HTMLElement>(".markdown-table-scroll")!;
    const title = text.querySelector<HTMLElement>(".markdown-checklist-heading__title")!;
    const total = text.querySelector<HTMLElement>(".markdown-checklist-progress")!;

    expect(getComputedStyle(frame).minWidth).toBe("0px");
    expect(getComputedStyle(tableScroll).overflowX).toBe("auto");
    expect(getComputedStyle(title).minWidth).toBe("0px");
    expect(getComputedStyle(total).flexShrink).toBe("0");
  });

  it("defines the exact desktop rich-tooltip card, arrow, header, body, and definition rows", () => {
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip-trigger\s*\{[^}]*color:\s*inherit;[^}]*text-decoration-style:\s*dashed;[^}]*text-decoration-thickness:\s*1px;[^}]*text-underline-offset:\s*2px;[^}]*cursor:\s*pointer;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip-trigger:hover,\s*\.markdown-rich-tooltip-trigger\[aria-expanded="true"\]\s*\{[^}]*color:\s*#f0f5f8;[^}]*text-decoration-color:\s*var\(--accent-strong\);/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip--desktop\s*\{[^}]*position:\s*fixed;[^}]*width:\s*344px;[^}]*max-height:\s*var\(--markdown-rich-tooltip-max-height\);[^}]*overflow:\s*visible;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip--desktop\s*\{[^}]*--markdown-rich-tooltip-gap:\s*14px;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__card\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*inherit;[^}]*display:\s*flex;[^}]*overflow:\s*hidden;[^}]*flex-direction:\s*column;[^}]*border:\s*1px solid #42454b;[^}]*border-radius:\s*6px;[^}]*background:\s*var\(--surface-2\);[^}]*box-shadow:\s*0 14px 34px rgba\(0, 0, 0, \.48\);/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__arrow\s*\{[^}]*width:\s*11px;[^}]*height:\s*11px;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__arrow\s*\{[^}]*top:\s*var\(--markdown-rich-tooltip-arrow-top\);/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip\[data-side="right"\] \.markdown-rich-tooltip__arrow\s*\{[^}]*left:\s*-6px;[^}]*border-top:\s*0;[^}]*border-right:\s*0;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip\[data-side="left"\] \.markdown-rich-tooltip__arrow\s*\{[^}]*right:\s*-6px;[^}]*border-bottom:\s*0;[^}]*border-left:\s*0;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__header\s*\{[^}]*min-height:\s*39px;[^}]*padding:\s*5px 6px 5px 12px;[^}]*border-bottom:\s*1px solid var\(--line-soft\);[^}]*background:\s*#202226;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__close\s*\{[^}]*width:\s*27px;[^}]*height:\s*27px;[^}]*border-radius:\s*4px;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__body\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*12px;[^}]*overflow:\s*auto;[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.48;/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip__definition-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*82px minmax\(0, 1fr\);[^}]*gap:\s*8px;[^}]*padding:\s*6px 0;[^}]*border-bottom:\s*1px solid var\(--line-soft\);/s);
  });

  it("defines fullscreen viewport, safe areas, internal scrolling, coarse targets, and reduced motion", () => {
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip--fullscreen\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*width:\s*100dvw;[^}]*height:\s*100dvh;[^}]*background:\s*var\(--surface-2\);/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip--fullscreen \.markdown-rich-tooltip__header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*padding-top:\s*calc\(5px \+ env\(safe-area-inset-top\)\);/s);
    expect(productionStyles).toMatch(/\.markdown-rich-tooltip--fullscreen \.markdown-rich-tooltip__body\s*\{[^}]*flex:\s*1;[^}]*overflow-y:\s*auto;[^}]*padding-bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom\)\);/s);
    expect(productionStyles).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*?\.markdown-rich-tooltip__close\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
    expect(productionStyles).toMatch(/animation:\s*markdown-rich-tooltip-enter 120ms ease-out;/);
    expect(productionStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.markdown-rich-tooltip\s*\{[^}]*animation:\s*none;/);
  });
});
