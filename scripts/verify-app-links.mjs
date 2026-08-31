#!/usr/bin/env node
/**
 * Live App Links probe — fetches `/.well-known/assetlinks.json` from every host
 * in `APP_LINK_HOSTS` and reports whether it can actually verify the installed
 * app id. The build-time guard (`check-deep-links.mjs`) only sees the repo; this
 * one sees what Android sees.
 *
 * Usage:
 *   node scripts/verify-app-links.mjs                  # report only (exit 0)
 *   node scripts/verify-app-links.mjs --strict         # non-zero on any failure
 *   ANDROID_PACKAGE_NAME=com.naveenbharat.app node scripts/verify-app-links.mjs
 *
 * Only one app id is expected: com.naveenbharat.app (the legacy
 * com.sadguru.classes id and its host were retired).
 */
import fs from "node:fs";
import path from "node:path";

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || "com.naveenbharat.app";
const strict = process.argv.includes("--strict");

const cfg = fs.readFileSync(
  path.join(process.cwd(), "src", "config", "deepLinks.ts"),
  "utf8",
);
const block = cfg.match(/export const APP_LINK_HOSTS = \[([\s\S]*?)\] as const;/);
if (!block) {
  console.error("❌ could not parse APP_LINK_HOSTS from src/config/deepLinks.ts");
  process.exit(1);
}
const hosts = [
  ...block[1].replace(/^\s*\/\/.*$/gm, "").matchAll(/"([^"]+)"/g),
].map((m) => m[1]);

const FP = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;
let failures = 0;

for (const host of hosts) {
  const url = `https://${host}/.well-known/assetlinks.json`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.log(`❌ ${host} — HTTP ${res.status}`);
      failures++;
      continue;
    }
    const json = JSON.parse(await res.text());
    const stmt = (Array.isArray(json) ? json : []).find(
      (s) => s?.target?.package_name === PACKAGE_NAME,
    );
    if (!stmt) {
      const found = (Array.isArray(json) ? json : [])
        .map((s) => s?.target?.package_name)
        .filter(Boolean)
        .join(", ");
      console.log(
        `❌ ${host} — no statement for ${PACKAGE_NAME} (serves: ${found || "none"})`,
      );
      failures++;
      continue;
    }
    const fps = stmt.target.sha256_cert_fingerprints ?? [];
    const bad = fps.filter((f) => !FP.test(String(f)));
    if (!fps.length || bad.length) {
      console.log(
        `❌ ${host} — fingerprint problem: ${bad.length ? bad.join(", ") : "empty array"}`,
      );
      failures++;
      continue;
    }
    console.log(`✅ ${host} — ${fps.length} fingerprint(s) for ${PACKAGE_NAME}`);
  } catch (e) {
    console.log(`❌ ${host} — unreachable (${e.message})`);
    failures++;
  }
}

console.log(
  failures
    ? `\n${failures}/${hosts.length} host(s) cannot verify App Links — see docs/DEEP-LINKS.md`
    : `\nAll ${hosts.length} host(s) can verify App Links for ${PACKAGE_NAME}.`,
);
process.exit(strict && failures ? 1 : 0);
