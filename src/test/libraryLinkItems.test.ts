/**
 * Link items are ordinary library items — regression test against a real
 * (fake-indexeddb) store. Pins: links land inside a folder, dedupe by URL,
 * survive move/reorder like files, and getItemUri resolves the remote URL.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";

let lib: typeof import("../services/personalLibrary");

const DRIVE = "https://drive.google.com/file/d/15WP1GuLJlrsdz878muiWnmZRjUzcjWdx/view";

describe("link items in My Library", () => {
  beforeAll(async () => {
    lib = await import("../services/personalLibrary");
  });

  it("adds a link into a folder and dedupes the same URL", async () => {
    const folder = await lib.getOrCreateFolder("Link Test A");
    const first = await lib.addLinkToFolder(folder.id, {
      url: DRIVE,
      title: "Biomolecules",
      source: "drive",
      kind: "PDF",
    });
    expect(first.folder_id).toBe(folder.id);
    expect(first.source).toBe("link");
    expect(first.size_bytes).toBe(0);

    const again = await lib.addLinkToFolder(folder.id, {
      url: DRIVE,
      title: "Biomolecules again",
      source: "drive",
      kind: "PDF",
    });
    expect(again.id).toBe(first.id);

    const items = await lib.listItems(folder.id);
    expect(items).toHaveLength(1);
  }, 20000);

  it("resolves to the remote URL and can be moved between folders", async () => {
    const src = await lib.getOrCreateFolder("Link Test B");
    const dest = await lib.getOrCreateFolder("Link Test C");
    const item = await lib.addLinkToFolder(src.id, {
      url: "https://cdn.example.com/notes.pdf",
      title: "Notes",
      source: "cdn",
      kind: "PDF",
    });

    expect(await lib.getItemUri(item.id)).toBe("https://cdn.example.com/notes.pdf");

    await lib.moveItem(item.id, dest.id);
    expect((await lib.listItems(src.id)).length).toBe(0);
    expect((await lib.listItems(dest.id)).map((i) => i.id)).toContain(item.id);
  }, 20000);
});
