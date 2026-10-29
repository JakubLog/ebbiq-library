# Ebbiq library

Block manifests, content schemas and learning templates for the Ebbiq learning app.

The app renders a workspace only from a declarative config plus the blocks listed here. This repository holds
**data only**: manifests, JSON Schemas and templates. Block React components live in the app; v1 loads no
external code from this repository.

## Structure

```
schemas/                          JSON Schemas exported from the Zod source of truth (do not edit by hand)
  block.schema.json               block.json
  template.schema.json            template.json
  workspace-config.v1.schema.json workspace config (embedded in templates)
  content/<name>.schema.json      item content per official exercise block
blocks/<namespace>/<name>/
  block.json                      block manifest; id must equal "<namespace>/<name>"
  content.schema.json             exercise blocks only: schema of an item's content
templates/<namespace>/<name>/
  template.json                   template manifest; id must equal "<namespace>/<name>"
scripts/validate.mjs              validator (run locally and in CI)
```

Official blocks (`core/*`, version 1.0.0):

| id | kind | notes |
| --- | --- | --- |
| `core/flashcard` | exercise | front/back, reveal, self-rating (`grading: self`) |
| `core/cloze` | exercise | sentence with exactly one `{{gap}}`, exact check tolerant to case and spaces (`grading: exact`) |
| `core/short-answer` | exercise | own words, graded by a model against a reference answer (`grading: ai`) |
| `core/fsrs` | scheduler | FSRS spaced repetition, 4-step rating |
| `core/active-recall` | pattern | recall first, then reveal |
| `core/default` | theme | light + dark |

Official templates (`official/*`, locale `pl`): `linux-commands` (Komendy Linuksa), `language-vocabulary`
(Słownictwo językowe), `docs-concepts` (Pojęcia z dokumentacji). Each ships starter topics and items so the first
review session is possible right after creating a workspace. Creating a workspace **copies** the template; later
template changes do not affect existing workspaces.

## Validate

```sh
pnpm install
pnpm validate            # or: node scripts/validate.mjs [libraryDir]
```

The validator checks every `block.json` / `template.json` against `schemas/`, plus rules JSON Schema cannot express
(they mirror the Zod refinements in the app):

- ids match directory paths and are unique;
- exercise blocks have `contentSchema` (existing file inside the block directory) and `grading`; themes have `modes`;
- `core/*` content schemas are byte-identical to `schemas/content/*`;
- template `requires` resolve to existing blocks with a satisfying version (`^X.Y.Z` = same major, npm caret
  semantics; or exact `X.Y.Z`);
- every block referenced by the workspace config (theme, pattern, scheduler, exercises) is listed in `requires`
  and has the expected kind; exercise blocks appear once;
- every starter item uses an exercise block enabled in the workspace, its content validates against the block's
  content schema, has no whitespace-only strings, fits in 8 KiB, and cloze texts contain exactly one `{{gap}}`;
- topic titles are unique within a template.

It exits non-zero and lists all errors as `file /json/pointer: message`. CI runs it on every push and pull request
(`.github/workflows/validate.yml`).

## Add a block

1. Create `blocks/<namespace>/<name>/block.json` (`id`, `version`, `kind`, `title`, `trust`, and per kind:
   `contentSchema` + `grading` for exercises, `modes` for themes). Titles and descriptions are user-facing (Polish).
2. Exercise blocks: add `content.schema.json` next to it. New exercise kinds also need a Zod content schema and a
   React component in the app repository — the library alone cannot introduce new behaviour.
3. Bump `version` (semver) on every change; a breaking content change is a new major and templates must update
   their `requires`.
4. Run `pnpm validate`.

## Add a template

1. Create `templates/<namespace>/<name>/template.json` with `id`, `version`, `title`, `description`, `locale`,
   `workspace` (a full workspace config v1), `requires` (every block the config and items use, e.g. `^1.0.0`),
   optional `starter.topics[].items[]` and `trust`.
2. Keep items factually correct and short; cloze texts need exactly one `{{gap}}` and every reasonable answer
   variant in `answers`.
3. Run `pnpm validate`.

## Regenerate schemas

Zod schemas in the app monorepo (`packages/schemas`) are the single source of truth. From the app repository root,
with this repository checked out at `library/`:

```sh
pnpm schemas:export                      # writes library/schemas (pass an ABSOLUTE path to write elsewhere)
cd library
for n in flashcard cloze short-answer; do cp schemas/content/$n.schema.json blocks/core/$n/content.schema.json; done
pnpm validate
```

## Trust levels

- `official` — maintained in this repository and reviewed by the maintainers.
- `community` — reserved. Community blocks and templates (submission, review, trust signals) are out of MVP scope;
  the app currently ships only official content.

## License

MIT — see [LICENSE](LICENSE).
