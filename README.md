# Ebbiq library

Block manifests, content schemas, learning templates and icons for the Ebbiq learning app.

The app renders a workspace only from a declarative config plus the blocks listed here. This repository holds
**data only**: manifests, JSON Schemas, templates and icon drawings. Block React components live in the app; v1
loads no external code from this repository.

## Structure

```
schemas/                          JSON Schemas exported from the Zod source of truth (do not edit by hand)
  block.schema.json               block.json
  template.schema.json            template.json
  workspace-config.v1.schema.json workspace config (embedded in templates)
  icon.schema.json                icon.json
  content/<name>.schema.json      content per official exercise and game block
blocks/<namespace>/<name>/
  block.json                      block manifest; id must equal "<namespace>/<name>"
  content.schema.json             exercise and game blocks only: schema of an item's / a game's content
templates/<namespace>/<name>/
  template.json                   template manifest; id must equal "<namespace>/<name>"
icons/<namespace>/<name>/
  icon.json                       isometric icon of workspaces and subjects; id must equal "<namespace>/<name>"
scripts/validate.mjs              validator (run locally and in CI)
```

Official blocks (`core/*`, version 1.0.0):

| id | kind | notes |
| --- | --- | --- |
| `core/flashcard` | exercise | front/back, reveal, self-rating (`grading: self`) |
| `core/cloze` | exercise | sentence with exactly one `{{gap}}`, exact check tolerant to case and spaces (`grading: exact`) |
| `core/short-answer` | exercise | own words, graded by a model against a reference answer (`grading: ai`) |
| `core/fsrs` | scheduler | FSRS spaced repetition, 4-step rating |
| `core/active-recall` | pattern | default: recall first, then reveal |
| `core/deck` | pattern | Anki-like deck: new / learning / review counters, no gamification |
| `core/path` | pattern | Duolingo-like path: topics as units of short lessons unlocked in order, XP and a day streak |
| `core/modes` | pattern | Quizlet-like modes: Learn (spaced repetition), Test (score in %), Match (pairs against the clock) |
| `core/default` | theme | light + dark |
| `core/pairs` | game | match 3–10 term ↔ definition pairs against the clock |
| `core/sort` | game | sort 4–16 cards into 2–4 named buckets |
| `core/sequence` | game | put 3–10 steps in the right order |

Official templates (`official/*`, locale `pl`): `linux-commands` (Komendy Linuksa), `language-vocabulary`
(Słownictwo językowe), `docs-concepts` (Pojęcia z dokumentacji). Each ships starter topics and items so the first
review session is possible right after creating a workspace. Creating a workspace **copies** the template; later
template changes do not affect existing workspaces.

Pattern blocks pick the learning architecture of a workspace: the app maps each official pattern id to its own
workspace home and session flow (the catalogue lives in the app repository, `docs/architectures.md`). A pattern the
app does not know falls back to `core/active-recall`.

Game blocks are short practice games: the app ships one player per official game id, and the AI only fills the
content (validated against the block's content schema). Each element (pair, card, step) may name the `itemId` of an
item of the same subject it practises. Game results never change spaced-repetition reviews.

## Validate

```sh
pnpm install
pnpm validate            # or: node scripts/validate.mjs [libraryDir]
```

The validator checks every `block.json` / `template.json` / `icon.json` against `schemas/`, plus rules JSON Schema
cannot express (they mirror the Zod refinements in the app):

- ids match directory paths and are unique;
- exercise blocks have `contentSchema` (existing file inside the block directory) and `grading`; game blocks have
  `contentSchema`; themes have `modes`;
- `core/*` content schemas are byte-identical to `schemas/content/*`;
- template `requires` resolve to existing blocks with a satisfying version (`^X.Y.Z` = same major, npm caret
  semantics; or exact `X.Y.Z`);
- every block referenced by the workspace config (theme, pattern, scheduler, exercises) is listed in `requires`
  and has the expected kind; exercise blocks appear once;
- every starter item uses an exercise block enabled in the workspace, its content validates against the block's
  content schema, has no whitespace-only strings, fits in 8 KiB, and cloze texts contain exactly one `{{gap}}`;
- topic titles are unique within a template;
- icons have at most 3 moving parts, 400 draw operations in total (parts' contents included) and 64 KB as compact
  JSON; `core/*` icons are `official` and all others `community` (priority at most 50); keywords shorter than 3
  characters end with a space; and the default icon `core/book` exists.

It exits non-zero and lists all errors as `file /json/pointer: message`. CI runs it on every push and pull request
(`.github/workflows/validate.yml`).

## Add a block

1. Create `blocks/<namespace>/<name>/block.json` (`id`, `version`, `kind`, `title`, `trust`, and per kind:
   `contentSchema` + `grading` for exercises, `contentSchema` for games, `modes` for themes). Titles and
   descriptions are user-facing (Polish).
2. Exercise and game blocks: add `content.schema.json` next to it. New exercise or game kinds also need a Zod
   content schema and a React component (player) in the app repository — the library alone cannot introduce new
   behaviour.
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

## Add an icon

Workspaces and subjects show an isometric illustration from `icons/`. An icon is a list of drawing operations, not
an image: the app draws every icon with the same projection, palette, line weights and plinth, so community icons
look like the official ones. Create `icons/<namespace>/<name>/icon.json` (validated by `schemas/icon.schema.json`):

```json
{
  "id": "community/telescope",
  "version": "1.0.0",
  "title": "Teleskop",
  "description": "astronomy, stargazing, optics",
  "keywords": ["astronom", "teleskop", "telescope", "optyk"],
  "priority": 20,
  "trust": "community",
  "ops": [{ "op": "cylinder", "center": [0, 0], "z": 0, "r": 6, "h": 30, "material": "dark" }]
}
```

**Axes and plinth.** x runs to the lower right, y to the lower left, z up; one world unit projects to one unit on
screen along each axis. Every icon stands on the app's plinth, whose top is z = 0 and covers x, y ∈ [-48, 48]; list
only what stands on it. Coordinates and lengths stay within ±160.

**Order.** Operations draw back to front in list order; nothing is sorted by depth. The viewer looks from +x, +y,
+z: draw far solids first and nearer ones (larger x + y) later. Each convex solid is correct on its own; split
concave shapes into convex pieces.

**Operations** (each mirrors a method of the app's isometric builder):

| op | shape |
| --- | --- |
| `box` | axis-aligned box from its lowest corner `at`, `size` = [x, y, z] |
| `solid` | parallelepiped from `origin` with edges `a`, `b`, `c`: tilted boards, open covers, lids |
| `roundBox` | box with rounded vertical edges of radius `r` |
| `prism` | convex `outline` in the xy plane, extruded from `z` up by `h` |
| `cylinder` | upright cylinder around `center` (x, y), from `z` up by `h` |
| `poly` | flat planar polygon (`points`, at least 3) |
| `quad` | parallelogram `origin`, `origin + a`, `origin + a + b`, `origin + b` |
| `disk` | flat filled circle around `center`, perpendicular to `normal` |
| `ring` | circle outline; with `sphere`, only the part on that sphere's visible half (globe grids, orbits) |
| `sphere` | shaded sphere with an inked outline |
| `line` | polyline through `points` (`closed` to close it) |
| `dot` | small round mark (rivet, LED); `r` in screen units, at most 6 |

**Materials and tones.** Surfaces take a `material`: `base`, `paper`, `accent` or `dark`; the app shades each face
from light to dark by its orientation (tops lightest, faces towards +x darkest). Solids may set `top`, `left` (face
towards +y) and `right` (face towards +x) separately; prisms and cylinders take `top` and an `inset` rim line. Flat
faces take `ink: false` for a colour patch without an outline and `shade` (0 dark … 8 light) for a fixed shade.
Lines, rings and dots take a `tone`: `ink` (outlines), `detail` (fine marks), `light` (marks on dark surfaces) or
`accent` (highlights). Colours belong to the app: an icon never names a colour.

**Moving parts.** Up to 3 operations may be `{ "op": "part", "motion": …, "ops": [ … ] }`: a group of draw
operations that moves as one while the pointer is on the card. A part draws in place in the list; parts do not nest.
The app owns the timing, so every icon moves alike; each part uses one of three motions:

- `slide` `{ "kind": "slide", "by": [x, y, z] }`: there and back along a world vector (a drawer, a paper strip);
- `swing` `{ "kind": "swing", "pivot": [x, y, z], "angle": 12 }`: rocks around the pivot by ± `angle` degrees (at
  most 30) in the picture's plane (an arm, a pendulum, scale pans);
- `bob` `{ "kind": "bob", "height": 4 }`: floats up and down by `height`.

Slide and bob distances are at most 24 units. Keep motions small: they hint at the object.

**Limits.** At most 400 draw operations in total (parts' contents included), 3 parts, 128 points per polygon or
line, 40 keywords and 64 KB as compact JSON: every icon ships to every client.

**Keywords and priority.** When nobody chose an icon, the app picks one from the workspace's name and goal (a
subject's name). Keywords are stems in lower-case ASCII (Polish letters folded: `wojewodztw`, `slowk`) matched at
the start of a word, so `geograf` matches „Geografia” and „geography”. A keyword ending with a space must match a
whole word (`"ai "` matches „AI w praktyce”, not „Aikido”); stems shorter than 3 characters are only allowed that
way. Among matching icons the highest `priority` (0–100, default 0; community icons at most 50, so an official icon
can always outrank them) wins, ties by id: give specific icons („województwa” → `core/map`) more than general ones
(„geografia” → `core/globe`). Without a match the app shows `core/book`. The AI picks icons by `title` and
`description`, so the description should say which subjects the icon fits.

**Trust.** `core/*` icons are `"trust": "official"`; icons in any other namespace (e.g. `community/telescope`) are
`"trust": "community"` — the validator enforces both. Bump
`version` on every change, then run `pnpm validate`.

## Regenerate schemas

Zod schemas in the app monorepo (`packages/schemas`) are the single source of truth. From the app repository root,
with this repository checked out at `library/`:

```sh
pnpm schemas:export                      # writes library/schemas (pass an ABSOLUTE path to write elsewhere)
cd library
for n in flashcard cloze short-answer pairs sort sequence; do cp schemas/content/$n.schema.json blocks/core/$n/content.schema.json; done
pnpm validate
```

## Trust levels

- `official` — maintained in this repository and reviewed by the maintainers.
- `community` — contributed icons (see [Add an icon](#add-an-icon)), reviewed in pull requests like everything
  else here. Community blocks and templates (submission, review, trust signals) are out of MVP scope.

## License

MIT — see [LICENSE](LICENSE).
