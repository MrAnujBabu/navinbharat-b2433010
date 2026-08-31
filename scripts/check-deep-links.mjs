#!/usr/bin/env node
/**
 * Deep-link regression guard.
 *
 * 1. No placeholder strings may ship under `public/.well-known/`
 *    (`REPLACE_WITH...`, `TEAMID`) — they silently break Android App Links /
 *    iOS Universal Links with no error log anywhere.
 * 2. `assetlinks.json` must be valid JSON with the expected package name. In
 *    CI/production the fingerprint array must be non-empty and well-formed
 *    (32-byte colon-separated SHA-256) — i.e. `scripts/gen-assetlinks.mjs`
 *    must have run with `ANDROID_CERT_SHA256` set.
 * 3. `APP_LINK_HOSTS` in `src/config/deepLinks.ts` must exactly match the
 *    `android:host` list in the App Links intent-filter of AndroidManifest.xml.
 *    Drift there breaks links just as quietly.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

const WELL_KNOWN = path.join(root, "public", ".well-known");
const ASSETLINKS = path.join(WELL_KNOWN, "assetlinks.json");
const MANIFEST = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const DEEP_LINKS = path.join(root, "src", "config", "deepLinks.ts");
const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || "com.naveenbharat.app";

const strict = process.env.CI === "true" || process.env.CI === "1" || process.env.VERCEL_ENV === "production";

// --- 1. placeholder sweep -------------------------------------------------
const PLACEHOLDERS = [/REPLACE_WITH/i, /\bTEAMID\b/];
if (fs.existsSync(WELL_KNOWN)) {
  for (const file of fs.readdirSync(WELL_KNOWN)) {
    const full = path.join(WELL_KNOWN, file);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const rx of PLACEHOLDERS) {
      if (rx.test(text)) {
        const isIOS = file === "apple-app-site-association";
        const msg = `public/.well-known/${file} contains placeholder ${rx} — links will not verify.`;
        // iOS TEAMID is a documented TODO until an iOS build exists.
        if (isIOS) console.warn(`⚠️  ${msg} (iOS TODO — no iOS build yet)`);
        else errors.push(msg);
      }
    }
  }
}

// --- 2. assetlinks shape -------------------------------------------------
if (!fs.existsSync(ASSETLINKS)) {
  errors.push("public/.well-known/assetlinks.json is missing.");
} else {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(ASSETLINKS, "utf8"));
  } catch (e) {
    errors.push(`assetlinks.json is not valid JSON: ${e.message}`);
  }
  if (Array.isArray(json)) {
    // Exactly one app id is claimed: the current package. The legacy
    // `com.sadguru.classes` statement was retired — any foreign app id here
    // would silently delegate link handling to an app we no longer ship.
    const packages = json.map((s) => s?.target?.package_name).filter(Boolean);
    const target = json.find((s) => s?.target?.package_name === PACKAGE_NAME)?.target;
    if (!target) {
      errors.push(
        `assetlinks.json has no statement for "${PACKAGE_NAME}" (found: ${packages.join(", ") || "none"}).`,
      );
    }
    const foreign = packages.filter((p) => p !== PACKAGE_NAME);
    if (foreign.length) {
      errors.push(
        `assetlinks.json claims foreign app id(s): ${foreign.join(", ")} — only "${PACKAGE_NAME}" is allowed.`,
      );
    }
    const fps = json.flatMap((s) => s?.target?.sha256_cert_fingerprints ?? []);
    const bad = fps.filter((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(String(f)));
    if (bad.length) {
      errors.push(`assetlinks.json has malformed fingerprint(s): ${bad.join(", ")}`);
    }
    if (!fps.length) {
      const msg =
        "assetlinks.json has no fingerprints — App Links will NOT verify. " +
        "Set ANDROID_CERT_SHA256 and run scripts/gen-assetlinks.mjs (docs/DEEP-LINKS.md).";
      if (strict) errors.push(msg);
      else console.warn(`⚠️  ${msg}`);
    }
  } else if (json !== undefined) {
    errors.push("assetlinks.json must be a JSON array of statements.");
  }
}

// --- 3. host parity ------------------------------------------------------
const readHosts = () => {
  const manifest = fs.readFileSync(MANIFEST, "utf8");
  const block = manifest.match(/<intent-filter android:autoVerify="true">[\s\S]*?<\/intent-filter>/);
  if (!block) {
    errors.push("AndroidManifest.xml has no autoVerify intent-filter (App Links disabled).");
    return null;
  }
  const manifestHosts = [...block[0].matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]);

  const cfg = fs.readFileSync(DEEP_LINKS, "utf8");
  const arr = cfg.match(/export const APP_LINK_HOSTS = \[([\s\S]*?)\] as const;/);
  if (!arr) {
    errors.push("Could not parse APP_LINK_HOSTS from src/config/deepLinks.ts.");
    return null;
  }
  // Strip `//` line comments so quoted strings inside comments (e.g. package
  // names or removed-host notes) don't pollute the host list.
  const cleaned = arr[1].replace(/^\s*\/\/.*$/gm, "");
  const configHosts = [...cleaned.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return { manifestHosts, configHosts };
};

if (fs.existsSync(MANIFEST) && fs.existsSync(DEEP_LINKS)) {
  const hosts = readHosts();
  if (hosts) {
    const a = [...hosts.manifestHosts].sort();
    const b = [...hosts.configHosts].sort();
    if (a.join(",") !== b.join(",")) {
      errors.push(
        "App Link host drift:\n" +
          `  AndroidManifest.xml: ${a.join(", ") || "(none)"}\n` +
          `  deepLinks.ts:        ${b.join(", ") || "(none)"}`,
      );
    }
  }
}

if (errors.length) {
  console.error("❌ Deep-link guard failed:");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log("✅ Deep-link guard passed (no placeholders, assetlinks shape ok, host parity ok).");
