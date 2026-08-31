#!/usr/bin/env node
/**
 * Guard: the Node version must be PINNED, never an open-ended range.
 *
 * Why: Vercel warns on `"engines": { "node": ">=22" }` because it silently
 * upgrades to the next major Node release — a build that works today can break
 * on Node 23/24 with no code change. We pin to `22.x` and keep
 * `.node-version` / `.nvmrc` in agreement so local, CI and Vercel all match.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const engine = pkg.engines?.node;

if (!engine) {
  errors.push('package.json is missing `engines.node` — pin it (e.g. "22.x").');
} else if (/[>^~*]|\|\||\s-\s|x\.x/.test(engine) && !/^\d+\.x$/.test(engine)) {
  errors.push(
    `package.json engines.node = "${engine}" is an open-ended range. ` +
      'Pin a single major (e.g. "22.x") — Vercel auto-upgrades open ranges.',
  );
}

const major = engine ? (engine.match(/^(\d+)/)?.[1] ?? null) : null;

for (const file of [".node-version", ".nvmrc"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) {
    errors.push(`${file} is missing — add it so local/CI match Vercel.`);
    continue;
  }
  const val = fs.readFileSync(p, "utf8").trim();
  const fileMajor = val.match(/^v?(\d+)/)?.[1] ?? null;
  if (major && fileMajor !== major) {
    errors.push(`${file} = "${val}" disagrees with package.json engines.node = "${engine}".`);
  }
}

const toolVersions = path.join(root, ".tool-versions");
if (fs.existsSync(toolVersions)) {
  const line = fs
    .readFileSync(toolVersions, "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("nodejs "));
  const tvMajor = line?.trim().split(/\s+/)[1]?.match(/^(\d+)/)?.[1] ?? null;
  if (major && tvMajor && tvMajor !== major) {
    errors.push(
      `.tool-versions nodejs "${line.trim().split(/\s+/)[1]}" disagrees with engines.node = "${engine}".`,
    );
  }
}

if (errors.length) {
  console.error("❌ node-pin guard failed:");
  for (const e of errors) console.error(`   • ${e}`);
  process.exit(1);
}

console.log(`✅ node-pin: engines.node = "${engine}", version files agree (Node ${major}).`);
