# Phase 2 Status - Content Integrity and Multiworld Linkage

> Scope source: `docs/MASTER-BLUEPRINT.md` Phase 2.

## Task Board

| Task | Status | Branch / Commit | Summary |
|---|---|---|---|
| 2.1 Phase 40 `worldRulesProfiles` multiworld | Done | `refactor/phase-2-task-2.1` / this task commit | `worldRulesProfiles` is now project+world scoped, loaded by world tab, exported/imported with world-group remap, lifecycle-covered by `PROJECT_TABLES`, and injected through `CONTEXT_SOURCES` with per-world timeline/keyword filtering. |
| 2.2 `chapter-adapter` real `worldRulesContext` | Done | `refactor/phase-2-task-2.2` / this task commit | `buildChapterContentPrompt` now accepts and renders `worldRulesContext`; `ChapterEditor` passes the assembled `worldRules` segment into chapter prose generation. |
| 2.3 `AIFieldCard` current value injection | Pending | - | Single-field AI generation should include the current field value by default and support rewrite/expand/polish modes. |
| 2.4 `chunk-writer` target `worldGroupId` | Pending | - | Import sessions and chunk writes should route imported data to the selected world. |
| 2.5 Batch detail/content `worldContextResolver` | Pending | - | Batch detailed outline/content generation should resolve context per chapter/world. |
| 2.6 Character JSON reference remap | Pending | - | Character delete/merge should remove or rewrite JSON-array references. |
| 2.7 Selective state extraction | Pending | - | State extraction should use selective state recall instead of full state context. |
| 2.8 Remaining P1 fixes | Pending | - | Close remaining P1 issues listed in `MASTER-BLUEPRINT.md`. |

## 2.1 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/registry/assemble-context.test.ts tests/regression/R-03-export-world-group-remap.test.ts tests/registry/project-tables.test.ts`: 3 files / 15 tests passed.
- `npm test`: 13 files / 40 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.1 Completion Notes

- DB schema v27 changes `worldRulesProfiles` to `++id, projectId, worldGroupId`.
- `WorldRulesPanel` adds per-world tabs in multiworld projects and filters historical preview data by current world.
- `buildWorldRulesContext(projectId, worldGroupId?)` resolves explicit worlds strictly, falls back to null/default/primary only for project-level calls, and filters historical timeline/keyword helpers by effective world.
- `CONTEXT_SOURCES.worldRules` is now a world-scoped source.
- `PROJECT_TABLES` now marks `worldRulesProfiles` as world-scoped/exportable with `worldGroupId` remap, so stamp/delete/export paths are registry-derived.
- Batch outline generation now supports a per-volume `worldRulesContextResolver`, preventing default-world rules from leaking into parallel-world batch outline generation.

## 2.2 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-11-chapter-world-rules-context.test.ts`: 1 file / 1 test passed.
- `npm test`: 14 files / 41 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.2 Completion Notes

- `buildChapterContentPrompt` now passes `worldRulesContext` into `renderPrompt` for the `chapter.content` seed.
- `ChapterEditor` extracts the `worldRules` segment from `assembleContext()` and sends it as a dedicated adapter variable.
- R-11 verifies the actual rendered prompt messages contain the real-vs-fiction rule text.
