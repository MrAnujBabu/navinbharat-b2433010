#!/usr/bin/env node
/**
 * Generates `public/.well-known/assetlinks.json` from the `ANDROID_CERT_SHA256`
 * env var so the release fingerprint is a BUILD INPUT, never a committed
 * literal.
 *
 * Why this exists: the file used to ship a placeholder string
 * (`REPLACE_WITH_NEW_UPLOAD_KEY_SHA256_...`). Android's `autoVerify` silently
 * failed against it, so every App Link (course, lesson, payment return) opened
 * in Chrome instead of the app — with zero error logs.
 *
 * Usage:
 *   ANDROID_CERT_SHA256="AA:BB:...:99,11:22:...:88" node scripts/gen-assetlinks.mjs
 *
 * Accepts multiple fingerprints separated by comma / semicolon / newline so the
 * upload key, the Play app-signing key and (optionally) a debug key can all be
 * listed. Colons are optional; hex case is normalised.
 *
 * Behaviour when the env var is absent:
 *   - normal build (local / CI APK / e2e) → warn, leave committed file, exit 0
 *   - VERCEL_ENV=production or ASSETLINKS_STRICT=1 → hard failure

 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = path.join(process.cwd(), "public", ".well-known", "assetlinks.json");
// Exactly ONE app id is claimed: com.naveenbharat.app. The legacy
// `com.sadguru.classes` id and its host were retired — do not reintroduce a
// multi-package list here; `check-deep-links.mjs` fails on foreign app ids.
const PACKAGE_NAME = (process.env.ANDROID_PACKAGE_NAME || "com.naveenbharat.app").trim();

// Strictness is DELIBERATELY not keyed off bare `CI=true`: GitHub Actions sets
// it for every job, which made the APK / e2e / Lighthouse builds hard-fail on a
// missing secret even though they never publish a web deploy.
// Strict = a real web publish (Vercel production) or an explicit opt-in.
const strictOptIn =
  process.env.ASSETLINKS_STRICT === "1" || process.env.ASSETLINKS_STRICT === "true";
// NOTE: deliberately NOT keyed off NODE_ENV — every local/preview `vite build`
// sets it to "production" and would then refuse to build without the secret.
const isProd = process.env.VERCEL_ENV === "production";
const strict = strictOptIn || isProd;

/**
 * Fallback sources when ANDROID_CERT_SHA256 is unset, in priority order:
 *   1. `.android-cert-sha256` in the repo root (git-ignored, local dev)
 *   2. the release keystore (KEYSTORE_BASE64 secret, or android/app/release.keystore)
 * This is what removes the "ℹ️ assetlinks: ... not set" notice on any machine
 * that already has the signing key — the fingerprint is derived, never guessed.
 */
function sha256FromKeystore() {
  const password = process.env.KEYSTORE_PASSWORD || process.env.ANDROID_KEYSTORE_PASSWORD;
  const alias = process.env.KEY_ALIAS || process.env.ANDROID_KEY_ALIAS;
  if (!password) return "";

  let keystorePath = "";
  let tmp = "";
  const b64 = process.env.KEYSTORE_BASE64 || process.env.ANDROID_KEYSTORE_BASE64;
  const committed = path.join(process.cwd(), "android", "app", "release.keystore");
  try {
    if (b64) {
      tmp = path.join(os.tmpdir(), `assetlinks-${process.pid}.jks`);
      fs.writeFileSync(tmp, Buffer.from(b64, "base64"));
      keystorePath = tmp;
    } else if (fs.existsSync(committed)) {
      keystorePath = committed;
    } else {
      return "";
    }

    const args = ["-list", "-v", "-keystore", keystorePath, "-storepass", password];
    if (alias) args.push("-alias", alias);
    const out = execFileSync("keytool", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/SHA256:\s*([0-9A-Fa-f:]{95})/);
    return m ? m[1] : "";
  } catch {
    return "";
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
  }
}

function readLocalFingerprintFile() {
  const file = path.join(process.cwd(), ".android-cert-sha256");
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join(",");
  } catch {
    return "";
  }
}

const raw = (
  process.env.ANDROID_CERT_SHA256 ||
  readLocalFingerprintFile() ||
  sha256FromKeystore() ||
  ""
).trim();

function fail(msg) {
  console.error(`❌ assetlinks: ${msg}`);
  process.exit(1);
}

function normalize(fp) {
  const hex = fp.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 64) {
    fail(
      `fingerprint "${fp.trim()}" has ${hex.length / 2} bytes, expected 32 (SHA-256).`,
    );
  }
  return (hex.match(/.{2}/g) || []).join(":");
}

if (!raw) {
  if (strict) {
    fail(
      "ANDROID_CERT_SHA256 is not set — Android App Links cannot verify.\n" +
        "   Web: set it in Vercel project env (Production + Preview + Development).\n" +
        "   CI: repo secret ANDROID_CERT_SHA256. See docs/DEEP-LINKS.md.",
    );
  }
  // Non-publish build (local / Vercel preview+dev / CI APK / e2e). If the
  // committed assetlinks.json already carries a real fingerprint there is
  // nothing to say — stay silent so the build log is clean. Only speak up when
  // the committed file would actually fail App Links verification.
  let committedOk = false;
  try {
    const committed = JSON.parse(fs.readFileSync(OUT, "utf8"));
    committedOk = committed.some?.((e) =>
      (e?.target?.sha256_cert_fingerprints || []).some(
        (f) => typeof f === "string" && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(f.trim()),
      ),
    );
  } catch { /* missing or unparsable → warn below */ }
  if (!committedOk) {
    console.log(
      "ℹ️  assetlinks: no fingerprint available — set ANDROID_CERT_SHA256, drop it in .android-cert-sha256, or provide the release keystore (KEYSTORE_BASE64/KEYSTORE_PASSWORD[/KEY_ALIAS] or android/app/release.keystore). App Links will not verify until then. See docs/DEEP-LINKS.md.",
    );
  }
  process.exit(0);

}


const fingerprints = [
  ...new Set(
    raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalize),
  ),
];

if (!fingerprints.length) fail("ANDROID_CERT_SHA256 produced no usable fingerprints.");

const statements = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: PACKAGE_NAME,
      sha256_cert_fingerprints: fingerprints,
    },
  },
];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(statements, null, 2)}\n`, "utf8");

console.log(
  `✅ assetlinks: wrote ${fingerprints.length} fingerprint(s) for ${PACKAGE_NAME} → public/.well-known/assetlinks.json`,
);
