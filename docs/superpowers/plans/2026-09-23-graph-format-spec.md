# Graph Format Specification Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for this documentation task. No application behavior changes.

**Goal:** Publish a standalone Russian specification that another agent can use to generate valid graph-note source without repository or conversation context.

**Architecture:** Describe the implemented parser contract, distinguish required syntax from generation recommendations, and verify all complete DOT examples with the application parser.

**Tech Stack:** Markdown documentation; existing TypeScript graph parser for temporary verification.

**Spec:** The user's request to document the existing format; authoritative contract in `src/domain/graph/parser.ts`, `types.ts`, `progress.ts`, and `docs/superpowers/specs/2026-09-23-graph-notes-design.md`.

## Constraints and review focus

- One documentation commit, Jujutsu only; preserve existing commits and authored data.
- Deliver `docs/graph-format-spec.md`, linked from README and `docs/graph-notes.md`.
- Standalone content: output contract, grammar, attributes/defaults, ownership/edges, states, structural layout, limits, accepted/rejected examples, generation checklist, reusable agent prompt and optional local validation command.
- Document actual syntax, including escaping and case sensitivity; do not invent attributes, format versions or Graphviz behavior.
- Distinguish raw DOT output from JSON/container metadata and Markdown fences.
- Examples are generic, not authored database content. Verification scripts remain temporary; no code changes, dependencies or permanent tests.

## Task 1: Write and verify the specification

- [x] A subagent writes the standalone specification and links, verifying factual rules directly against parser and model.
- [x] The controller checks every complete valid DOT example with `parseGraph` and every deliberately invalid example with `validateGraph`; review edge cases and cross-links.
- [x] Perform a bounded documentation review, remove temporary verifiers and inspect `jj status` / `jj diff`.
- [x] Finalize one commit using `jj describe`, then `jj new`; deliver the specification link.
