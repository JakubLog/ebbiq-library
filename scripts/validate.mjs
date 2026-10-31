#!/usr/bin/env node
/**
 * Validates the library: every block.json / template.json / icon.json against the JSON Schemas in `schemas/`
 * (exported from the Zod source of truth in the app monorepo) plus the cross-file rules that
 * JSON Schema cannot express (the Zod refinements, references between templates and blocks, icon limits).
 *
 * Usage: node scripts/validate.mjs [libraryDir]   (default: the directory above this script)
 * Exit code: 0 when valid, 1 when any error was found (all errors are listed).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const errors = [];
const rel = (p) => relative(root, p) || ".";
const fail = (file, path, message) => errors.push(`${rel(file)}${path ? ` ${path}` : ""}: ${message}`);

// Mirrors of constants/refinements in @ebbiq/schemas that the JSON Schema export cannot carry.
const CLOZE_GAP = "{{gap}}";
const MAX_ITEM_CONTENT_BYTES = 8 * 1024;
const CONFIG_KINDS = { theme: "theme", pattern: "pattern", scheduler: "scheduler", exercise: "exercise" };
// ICON_LIMITS, OFFICIAL_ICON_NAMESPACE and DEFAULT_ICON_ID in @ebbiq/schemas.
const ICON_MAX_OPS = 400;
const ICON_MAX_PARTS = 3;
const ICON_MAX_BYTES = 64 * 1024;
const ICON_MAX_COMMUNITY_PRIORITY = 50;
const OFFICIAL_ICON_NAMESPACE = "core";
const DEFAULT_ICON_ID = "core/book";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(file, "", e.code === "ENOENT" ? "file not found" : `invalid JSON (${e.message})`);
    return undefined;
  }
}

function compileSchema(file) {
  const schema = readJson(file);
  if (schema === undefined) return undefined;
  try {
    return ajv.compile(schema);
  } catch (e) {
    fail(file, "", `invalid JSON Schema (${e.message})`);
    return undefined;
  }
}

function formatAjvError(e) {
  const where = e.instancePath || "/";
  if (e.keyword === "additionalProperties") return [where, `unknown property "${e.params.additionalProperty}"`];
  if (e.keyword === "enum") return [where, `${e.message}: ${e.params.allowedValues.map((v) => JSON.stringify(v)).join(", ")}`];
  if (e.keyword === "pattern") return [where, `does not match ${e.params.pattern}`];
  return [where, e.message];
}

function checkSchema(validate, data, file, prefix = "") {
  if (!validate || validate(data)) return true;
  for (const e of validate.errors) {
    const [where, message] = formatAjvError(e);
    fail(file, prefix ? `${prefix}${where === "/" ? "" : where}` : where, message);
  }
  return false;
}

/** Subdirectories `<ns>/<name>` of `dir`, each expected to hold `manifestName`. */
function listManifests(dir, manifestName) {
  const out = [];
  if (!existsSync(dir)) {
    fail(dir, "", "directory not found");
    return out;
  }
  for (const ns of readdirSync(dir).sort()) {
    const nsDir = join(dir, ns);
    if (ns.startsWith(".") || !statSync(nsDir).isDirectory()) continue;
    for (const name of readdirSync(nsDir).sort()) {
      const entryDir = join(nsDir, name);
      if (name.startsWith(".") || !statSync(entryDir).isDirectory()) continue;
      const file = join(entryDir, manifestName);
      if (!existsSync(file)) fail(entryDir, "", `missing ${manifestName}`);
      else out.push({ file, dirId: `${ns}/${name}`, dir: entryDir });
    }
  }
  return out;
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] } : undefined;
}

function compareCore(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** `^X.Y.Z` (npm caret semantics, prereleases excluded) or exact `X.Y.Z`. */
function satisfies(version, range) {
  const v = parseVersion(version);
  const caret = range.startsWith("^");
  const r = parseVersion(caret ? range.slice(1) : range);
  if (!v || !r) return false;
  if (!caret) return version === range;
  if (v.pre || compareCore(v, r) < 0) return false;
  if (r.major > 0) return v.major === r.major;
  if (r.minor > 0) return v.major === 0 && v.minor === r.minor;
  return v.major === 0 && v.minor === 0 && v.patch === r.patch;
}

/** Zod trims strings before `min(1)`: whitespace-only strings are rejected by the app. */
function checkBlankStrings(value, file, path) {
  if (typeof value === "string") {
    if (value.length > 0 && value.trim().length === 0) fail(file, path, "must not be blank (whitespace only)");
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkBlankStrings(v, file, `${path}/${i}`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) checkBlankStrings(v, file, `${path}/${k}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Schemas

const schemasDir = join(root, "schemas");
const validateBlock = compileSchema(join(schemasDir, "block.schema.json"));
const validateTemplate = compileSchema(join(schemasDir, "template.schema.json"));
const validateWorkspace = compileSchema(join(schemasDir, "workspace-config.v1.schema.json"));
const validateIcon = compileSchema(join(schemasDir, "icon.schema.json"));

// ---------------------------------------------------------------------------------------------
// Blocks

/** id -> { manifest, file, validateContent? } */
const blocks = new Map();

for (const { file, dirId, dir } of listManifests(join(root, "blocks"), "block.json")) {
  const m = readJson(file);
  if (m === undefined) continue;
  const valid = checkSchema(validateBlock, m, file);
  if (!m || typeof m !== "object") continue;

  if (m.id !== dirId) fail(file, "/id", `"${m.id}" does not match directory path "${dirId}"`);
  if (blocks.has(m.id)) {
    fail(file, "/id", `duplicate block id "${m.id}" (also in ${rel(blocks.get(m.id).file)})`);
    continue;
  }
  const entry = { manifest: m, file, valid };
  blocks.set(m.id, entry);

  if (m.kind === "exercise") {
    if (!m.contentSchema) fail(file, "/contentSchema", "exercise blocks require contentSchema");
    if (!m.grading) fail(file, "/grading", "exercise blocks require grading");
  }
  if (m.kind === "game" && !m.contentSchema) fail(file, "/contentSchema", "game blocks require contentSchema");
  if (m.kind === "theme" && !m.modes) fail(file, "/modes", "theme blocks require modes");
  if (Array.isArray(m.modes) && new Set(m.modes).size !== m.modes.length) fail(file, "/modes", "modes must be unique");

  if (typeof m.contentSchema === "string" && m.contentSchema.length > 0) {
    const schemaFile = resolve(dir, m.contentSchema);
    if (!schemaFile.startsWith(dir + sep)) {
      fail(file, "/contentSchema", "must point to a file inside the block directory");
    } else if (!existsSync(schemaFile)) {
      fail(file, "/contentSchema", `content schema ${rel(schemaFile)} not found`);
    } else {
      entry.validateContent = compileSchema(schemaFile);
      // Official core blocks must ship exactly the schema exported from Zod.
      const exported = join(schemasDir, "content", `${dirId.split("/")[1]}.schema.json`);
      if (dirId.startsWith("core/") && existsSync(exported)) {
        if (readFileSync(exported, "utf8") !== readFileSync(schemaFile, "utf8")) {
          fail(schemaFile, "", `differs from ${rel(exported)}; copy the exported schema after regenerating`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Templates

const templates = new Map();
let starterItems = 0;

for (const { file, dirId } of listManifests(join(root, "templates"), "template.json")) {
  const t = readJson(file);
  if (t === undefined) continue;
  checkSchema(validateTemplate, t, file);
  if (!t || typeof t !== "object") continue;

  if (t.id !== dirId) fail(file, "/id", `"${t.id}" does not match directory path "${dirId}"`);
  if (templates.has(t.id)) {
    fail(file, "/id", `duplicate template id "${t.id}" (also in ${rel(templates.get(t.id))})`);
    continue;
  }
  templates.set(t.id, file);
  if (blocks.has(t.id)) fail(file, "/id", `"${t.id}" is already used by a block`);

  // requires: unique, resolvable, version satisfied
  const requires = Array.isArray(t.requires) ? t.requires : [];
  const required = new Set();
  requires.forEach((r, i) => {
    if (!r || typeof r.block !== "string") return;
    if (required.has(r.block)) fail(file, `/requires/${i}/block`, `"${r.block}" listed more than once`);
    required.add(r.block);
    const b = blocks.get(r.block);
    if (!b) fail(file, `/requires/${i}/block`, `block "${r.block}" does not exist in the library`);
    else if (typeof r.version === "string" && !satisfies(b.manifest.version, r.version)) {
      fail(file, `/requires/${i}/version`, `"${r.version}" is not satisfied by ${r.block}@${b.manifest.version}`);
    }
  });

  // workspace: schema (again, for focused messages), refinements, block references
  const ws = t.workspace;
  if (ws && typeof ws === "object") {
    checkSchema(validateWorkspace, ws, file, "/workspace");
    checkBlankStrings(ws.goal, file, "/workspace/goal");
    const refs = [
      ["/workspace/theme", ws.theme, CONFIG_KINDS.theme],
      ["/workspace/pattern", ws.pattern, CONFIG_KINDS.pattern],
      ["/workspace/scheduler/block", ws.scheduler?.block, CONFIG_KINDS.scheduler],
      ...(Array.isArray(ws.exercises) ? ws.exercises : []).map((e, i) => [`/workspace/exercises/${i}/block`, e?.block, CONFIG_KINDS.exercise]),
    ];
    for (const [path, id, kind] of refs) {
      if (typeof id !== "string") continue;
      if (!required.has(id)) fail(file, path, `block "${id}" is used but not listed in requires`);
      const b = blocks.get(id);
      if (!b) fail(file, path, `block "${id}" does not exist in the library`);
      else if (b.manifest.kind !== kind) fail(file, path, `block "${id}" has kind "${b.manifest.kind}", expected "${kind}"`);
    }
    if (Array.isArray(ws.exercises)) {
      const ids = ws.exercises.map((e) => e?.block);
      if (new Set(ids).size !== ids.length) fail(file, "/workspace/exercises", "each exercise block may appear only once");
    }
  }
  const enabledExercises = new Set((Array.isArray(ws?.exercises) ? ws.exercises : []).map((e) => e?.block));

  // starter topics and items
  const topics = Array.isArray(t.starter?.topics) ? t.starter.topics : [];
  const titles = new Set();
  topics.forEach((topic, ti) => {
    const tp = `/starter/topics/${ti}`;
    if (!topic || typeof topic !== "object") return;
    if (typeof topic.title === "string") {
      checkBlankStrings(topic.title, file, `${tp}/title`);
      const key = topic.title.trim().toLowerCase();
      if (titles.has(key)) fail(file, `${tp}/title`, `duplicate topic title "${topic.title}"`);
      titles.add(key);
    }
    (Array.isArray(topic.items) ? topic.items : []).forEach((item, ii) => {
      const ip = `${tp}/items/${ii}`;
      if (!item || typeof item.block !== "string") return;
      starterItems++;
      const b = blocks.get(item.block);
      if (!b) return fail(file, `${ip}/block`, `block "${item.block}" does not exist in the library`);
      if (b.manifest.kind !== "exercise") return fail(file, `${ip}/block`, `block "${item.block}" is not an exercise block`);
      if (!required.has(item.block)) fail(file, `${ip}/block`, `block "${item.block}" is used but not listed in requires`);
      if (!enabledExercises.has(item.block)) fail(file, `${ip}/block`, `block "${item.block}" is not enabled in workspace.exercises`);
      if (!b.validateContent) return fail(file, `${ip}/content`, `block "${item.block}" has no usable content schema`);
      checkSchema(b.validateContent, item.content, file, `${ip}/content`);
      checkBlankStrings(item.content, file, `${ip}/content`);
      if (Buffer.byteLength(JSON.stringify(item.content ?? null)) > MAX_ITEM_CONTENT_BYTES) {
        fail(file, `${ip}/content`, `content exceeds ${MAX_ITEM_CONTENT_BYTES} bytes`);
      }
      if (item.block === "core/cloze" && typeof item.content?.text === "string") {
        const gaps = item.content.text.split(CLOZE_GAP).length - 1;
        if (gaps !== 1) fail(file, `${ip}/content/text`, `must contain exactly one ${CLOZE_GAP} placeholder (found ${gaps})`);
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Icons

const icons = new Map();

for (const { file, dirId } of listManifests(join(root, "icons"), "icon.json")) {
  const icon = readJson(file);
  if (icon === undefined) continue;
  checkSchema(validateIcon, icon, file);
  if (!icon || typeof icon !== "object") continue;

  if (icon.id !== dirId) fail(file, "/id", `"${icon.id}" does not match directory path "${dirId}"`);
  if (icons.has(icon.id)) {
    fail(file, "/id", `duplicate icon id "${icon.id}" (also in ${rel(icons.get(icon.id))})`);
    continue;
  }
  icons.set(icon.id, file);
  checkBlankStrings(icon.title, file, "/title");
  checkBlankStrings(icon.description, file, "/description");

  const ops = Array.isArray(icon.ops) ? icon.ops : [];
  const parts = ops.filter((op) => op?.op === "part");
  if (parts.length > ICON_MAX_PARTS) fail(file, "/ops", `at most ${ICON_MAX_PARTS} moving parts (found ${parts.length})`);
  const total = ops.reduce((sum, op) => sum + (op?.op === "part" && Array.isArray(op.ops) ? op.ops.length : 1), 0);
  if (total > ICON_MAX_OPS) fail(file, "/ops", `at most ${ICON_MAX_OPS} draw operations in total (found ${total})`);
  const bytes = Buffer.byteLength(JSON.stringify(icon));
  if (bytes > ICON_MAX_BYTES) fail(file, "", `at most ${ICON_MAX_BYTES} bytes as compact JSON (found ${bytes})`);
  const official = typeof icon.id === "string" && icon.id.startsWith(`${OFFICIAL_ICON_NAMESPACE}/`);
  if (official !== (icon.trust === "official")) {
    fail(file, "/trust", `icons in "${OFFICIAL_ICON_NAMESPACE}/" are "official", icons in other namespaces "community"`);
  }
  if (icon.trust === "community" && (icon.priority ?? 0) > ICON_MAX_COMMUNITY_PRIORITY) {
    fail(file, "/priority", `community icons have priority at most ${ICON_MAX_COMMUNITY_PRIORITY}`);
  }
  for (const [i, keyword] of (Array.isArray(icon.keywords) ? icon.keywords : []).entries()) {
    if (typeof keyword === "string" && !keyword.endsWith(" ") && keyword.length < 3) {
      fail(file, `/keywords/${i}`, `"${keyword}": keywords shorter than 3 characters must end with a space`);
    }
  }
}
if (!icons.has(DEFAULT_ICON_ID)) fail(join(root, "icons"), "", `the default icon "${DEFAULT_ICON_ID}" is missing`);

// ---------------------------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`Library validation failed with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Library OK: ${blocks.size} blocks, ${templates.size} templates, ${starterItems} starter items, ${icons.size} icons.`,
);
