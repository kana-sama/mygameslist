# Local Development Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Vite development server a dark diagonal-striped canvas while preserving the production site's current solid background.

**Architecture:** Bootstrap code marks `<html>` when `import.meta.env.DEV` is true through one small, testable DOM helper. CSS routes canvas surfaces through a dedicated token so the development selector can use a gradient without changing the solid `--bg` token used by shadows and controls.

**Tech Stack:** TypeScript 7, Vite 8 environment constants, Vitest 4 with jsdom, CSS custom properties.

## Global Constraints

- `npm run dev` must use the selected dark plum diagonal-striped canvas.
- Production builds and `npm run preview` must retain the solid `#111214` canvas.
- Cards, fields, dialogs, navigation, typography, and interaction states must remain unchanged.
- The specification, implementation plan, test, and implementation must finish as exactly one Jujutsu commit.
- Use `jj` exclusively for repository inspection and commit operations.

---

### Task 1: Development-only canvas marker and style

**Files:**
- Create: `src/runtimeEnvironment.test.ts`
- Create: `src/runtimeEnvironment.ts`
- Modify: `src/main.tsx:1-9`
- Modify: `src/styles.css:1-30,180`
- Verify: `docs/superpowers/specs/2026-08-06-local-development-background-design.md`

**Interfaces:**
- Consumes: Vite's compile-time `import.meta.env.DEV: boolean` and the browser's `document.documentElement`.
- Produces: `markRuntimeEnvironment(element: HTMLElement, isDevelopment: boolean): void` and the root attribute `data-runtime-environment="development"`.

- [x] **Step 1: Write the failing runtime-marker tests**

Create `src/runtimeEnvironment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markRuntimeEnvironment } from "./runtimeEnvironment";

describe("markRuntimeEnvironment", () => {
  it("marks the root element in development mode", () => {
    const element = document.createElement("html");

    markRuntimeEnvironment(element, true);

    expect(element).toHaveAttribute("data-runtime-environment", "development");
  });

  it("leaves the root element unmarked outside development mode", () => {
    const element = document.createElement("html");
    element.setAttribute("data-runtime-environment", "development");

    markRuntimeEnvironment(element, false);

    expect(element).not.toHaveAttribute("data-runtime-environment");
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/runtimeEnvironment.test.ts`

Expected: FAIL because `./runtimeEnvironment` does not exist. Confirm the failure is caused only by the missing behavior, not by a test syntax error.

- [x] **Step 3: Implement the minimal runtime marker**

Create `src/runtimeEnvironment.ts`:

```ts
const RUNTIME_ENVIRONMENT_ATTRIBUTE = "data-runtime-environment";

export function markRuntimeEnvironment(element: HTMLElement, isDevelopment: boolean): void {
  if (isDevelopment) {
    element.setAttribute(RUNTIME_ENVIRONMENT_ATTRIBUTE, "development");
    return;
  }

  element.removeAttribute(RUNTIME_ENVIRONMENT_ATTRIBUTE);
}
```

In `src/main.tsx`, import the helper and invoke it before locating and rendering the React root:

```ts
import { markRuntimeEnvironment } from "./runtimeEnvironment";

markRuntimeEnvironment(document.documentElement, import.meta.env.DEV);
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/runtimeEnvironment.test.ts`

Expected: both tests PASS with no warnings.

- [x] **Step 5: Route canvas surfaces through a development-aware CSS token**

In `src/styles.css`, add the production-default token after `--bg`:

```css
  --canvas-background: var(--bg);
```

Add the development override after the `:root` block:

```css
:root[data-runtime-environment="development"] {
  --canvas-background: repeating-linear-gradient(-45deg, rgba(180, 100, 142, .08) 0 9px, transparent 9px 22px), #171319;
}
```

Replace only the canvas declarations on `html`, `body`, and `.tier-row` from `background: var(--bg)` to:

```css
background: var(--canvas-background);
```

Do not replace `var(--bg)` in controls or `box-shadow` declarations.

- [x] **Step 6: Run automated verification**

Run: `npm test`

Expected: all tests PASS with no warnings.

Run: `npm run build`

Expected: TypeScript and Vite production build complete successfully.

- [x] **Step 7: Verify development and production visuals**

Run the development server and confirm the `<html>` element has `data-runtime-environment="development"`; verify the diagonal pattern appears behind catalogue pages and within tier rows while surfaces remain unchanged.

Open the output of `npm run build` through `npm run preview`; confirm `<html>` has no runtime-environment attribute and the canvas remains solid `#111214`.

- [x] **Step 8: Inspect and finalize the single feature commit**

Run `jj status` and `jj diff`; confirm that only the approved specification, this plan, the runtime helper and test, `src/main.tsx`, and `src/styles.css` are included.

Describe the working-copy change:

```bash
jj describe -m "Distinguish the local development site"
```

Then create a fresh working-copy change:

```bash
jj new
```
