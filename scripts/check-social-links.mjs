#!/usr/bin/env node
/**
 * Guards:
 *  1. No hardcoded Telegram URLs outside src/config/socialLinks.ts.
 *  2. Any component that renders a social/handoff URL (t.me, wa.me, youtube,
 *     instagram, facebook, twitter/x) must also route through
 *     `openSocialLink` — a bare <a target="_blank"> is a no-op inside the
 *     Capacitor WebView, which is how in-app social links died before.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["src/config/socialLinks.ts"]);
const ROOT = "src";
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
    const rel = full.replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    if (rel.startsWith("src/test/") || /\.test\.tsx?$/.test(rel)) continue;
    const src = readFileSync(full, "utf8");
    src.split("\n").forEach((line, i) => {
      if (/["'`]https?:\/\/t\.me\//.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

walk(ROOT);

// Guard 2: components that render social handoff URLs must use openSocialLink.
const SOCIAL_URL_RE = /(t\.me\/|wa\.me\/|youtube\.com\/|youtu\.be\/|instagram\.com\/|facebook\.com\/|twitter\.com\/|x\.com\/)/;
const bareAnchors = [];

function walkAnchors(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkAnchors(full);
      continue;
    }
    if (!/\.tsx$/.test(entry)) continue;
    const rel = full.replace(/\\/g, "/");
    if (rel.startsWith("src/test/") || /\.test\.tsx?$/.test(rel)) continue;
    const src = readFileSync(full, "utf8");
    if (!SOCIAL_URL_RE.test(src)) continue;
    if (!/target="_blank"/.test(src)) continue;
    if (src.includes("openSocialLink")) continue;
    bareAnchors.push(rel);
  }
}

walkAnchors(ROOT);

let failed = false;
if (offenders.length > 0) {
  failed = true;
  console.error("Hardcoded Telegram URL found. Import TELEGRAM_URL from @/config/socialLinks instead:\n");
  offenders.forEach((o) => console.error("  " + o));
}
if (bareAnchors.length > 0) {
  failed = true;
  console.error(
    "\nSocial link rendered with a bare target=\"_blank\" (dead inside the Capacitor WebView).\n" +
      "Add the isNativeSync() + openSocialLink(url) onClick guard in:\n",
  );
  bareAnchors.forEach((f) => console.error("  " + f));
}
if (failed) process.exit(1);
console.log("check-social-links: OK — single Telegram source + all social anchors native-safe");
