/**
 * Local (file-manager) import regression test — runs the real personal-library
 * service against fake-indexeddb, no Capacitor Filesystem (browser fallback).
 *
 * Pins the crash-shield rules: over-size files are skipped before any read,
 * duplicates are skipped, and good files land in the folder.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";

let lib: typeof import("../services/personalLibrary");

function file(name: string, size: number) {
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("local import into My Library", () => {
  beforeAll(async () => {
    lib = await import("../services/personalLibrary");
  });

  it("skips a file above the per-file ceiling without reading it", async () => {
    const folder = await lib.getOrCreateFolder("Local Test A");
    const tooBig = file("huge.pdf", lib.getMaxFileBytes() + 1);
    // Reading it would throw here — the guard must fire first.
    Object.defineProperty(tooBig, "slice", {
      value: () => {
        throw new Error("must not read an over-size file");
      },
    });
    const res = await lib.addFilesToFolder(folder.id, [tooBig]);
    expect(res.added).toHaveLength(0);
    expect(res.skipped[0]).toMatchObject({ name: "huge.pdf", reason: "too-large" });
  });

  it("imports a normal file and dedups a repeat of the same name+size", async () => {
    const folder = await lib.getOrCreateFolder("Local Test B");
    const one = file("chapter-1.pdf", 1024);
    const first = await lib.addFilesToFolder(folder.id, [one]);
    expect(first.added).toHaveLength(1);
    expect(first.added[0].folder_id).toBe(folder.id);

    const again = await lib.addFilesToFolder(folder.id, [file("chapter-1.pdf", 1024)]);
    expect(again.added).toHaveLength(0);
    expect(again.skipped[0]).toMatchObject({ reason: "duplicate" });

    const items = await lib.listItems(folder.id);
    expect(items.map((i) => i.file_name)).toEqual(["chapter-1.pdf"]);
  }, 20000);
});
