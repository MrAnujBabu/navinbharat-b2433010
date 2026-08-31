/**
 * My Library import regression tests — local (file manager) and link paths.
 *
 * The personal-library service is mocked: these tests pin the *decision* logic
 * (size ceilings, source classification, offline eligibility, folder routing),
 * not IndexedDB/Filesystem behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MAX = 200 * 1024 * 1024;

vi.mock("../services/personalLibrary", () => ({
  getMaxFileBytes: () => 200 * 1024 * 1024,
  addFileToFolder: vi.fn(async (_folder: string, file: File) => ({ id: `item-${file.name}` })),
  addUrlToFolder: vi.fn(async () => ({ id: "item-url" })),
  getOrCreateFolder: vi.fn(async (name: string) => ({ id: `folder-${name}`, name })),
}));

import * as personalLibrary from "../services/personalLibrary";

const addFileToFolder = personalLibrary.addFileToFolder as unknown as ReturnType<typeof vi.fn>;
const addUrlToFolder = personalLibrary.addUrlToFolder as unknown as ReturnType<typeof vi.fn>;
const getOrCreateFolder = personalLibrary.getOrCreateFolder as unknown as ReturnType<typeof vi.fn>;

import {
  canSaveOffline,
  classifyLink,
  kindForLink,
  listSavedLinks,
  markLinkOffline,
  parseLink,
  removeLink,
  saveLink,
} from "../lib/linkSources";
import { fetchCapped, saveLinkOffline, OFFLINE_FOLDER } from "../lib/linkOfflineSave";

function streamOf(chunkSize: number, chunks: number, headers: Record<string, string> = {}) {
  let sent = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    body: {
      getReader: () => ({
        read: async () =>
          sent++ < chunks
            ? { done: false, value: new Uint8Array(chunkSize) }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

describe("link parsing + classification", () => {
  it("classifies the supported sources", () => {
    expect(classifyLink("https://drive.google.com/file/d/abc/view")).toBe("drive");
    expect(classifyLink("https://docs.google.com/document/d/abc/edit")).toBe("docs");
    expect(classifyLink("https://www.notion.so/My-Page-123")).toBe("notion");
    expect(classifyLink("https://archive.org/details/somebook")).toBe("archive");
    expect(classifyLink("https://cdn.jsdelivr.net/x/file.pdf")).toBe("cdn");
    expect(classifyLink("https://example.com/page")).toBe("web");
  });

  it("maps links to a viewer kind", () => {
    expect(kindForLink("https://x.com/a.pdf", "cdn")).toBe("PDF");
    expect(kindForLink("https://x.com/a.docx", "cdn")).toBe("DOCX");
    expect(kindForLink("https://x.com/a.png", "cdn")).toBe("IMAGE");
    expect(kindForLink("https://drive.google.com/file/d/a/view", "drive")).toBe("PDF");
  });

  it("rejects junk and non-http schemes", () => {
    expect(() => parseLink("")).toThrow();
    expect(() => parseLink("not a link")).toThrow();
    expect(() => parseLink("ftp://example.com/a.pdf")).toThrow();
    expect(() => parseLink("javascript:alert(1)")).toThrow();
  });

  it("normalises a bare host and derives a title", () => {
    const p = parseLink("example.com/docs/organic_chemistry.pdf");
    expect(p.url.startsWith("https://")).toBe(true);
    expect(p.title).toBe("organic chemistry");
    expect(p.offlineCapable).toBe(true);
  });

  it("keeps Notion stream-only, allows Drive/CDN offline", () => {
    expect(canSaveOffline("https://www.notion.so/x", "notion")).toBe(false);
    expect(canSaveOffline("https://drive.google.com/file/d/a/view", "drive")).toBe(true);
    expect(canSaveOffline("https://cdn.jsdelivr.net/a.pdf", "cdn")).toBe(true);
    expect(canSaveOffline("https://example.com/page", "web")).toBe(false);
  });
});

describe("link shelf persistence", () => {
  beforeEach(() => localStorage.clear());

  it("saves, dedups by url, marks offline and removes", () => {
    const rec = saveLink({ url: "https://x.com/a.pdf", title: "A", source: "cdn", kind: "PDF" });
    const again = saveLink({ url: "https://x.com/a.pdf", title: "A2", source: "cdn", kind: "PDF" });
    expect(again.id).toBe(rec.id);
    expect(listSavedLinks()).toHaveLength(1);

    markLinkOffline(rec.id, "item-1");
    expect(listSavedLinks()[0].offline_item_id).toBe("item-1");

    removeLink(rec.id);
    expect(listSavedLinks()).toHaveLength(0);
  });
});

describe("saveLinkOffline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses a stream-only source", async () => {
    await expect(
      saveLinkOffline({ url: "https://www.notion.so/x", title: "N", source: "notion" }),
    ).rejects.toThrow(/streams only/i);
    expect(addUrlToFolder).not.toHaveBeenCalled();
  });

  it("rejects an over-size file from the HEAD probe, before downloading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": String(MAX + 1) }),
        }) as unknown as Response,
      ),
    );
    await expect(
      saveLinkOffline({ url: "https://cdn.jsdelivr.net/big.pdf", title: "Big", source: "cdn" }),
    ).rejects.toThrow(/too large/i);
    expect(addUrlToFolder).not.toHaveBeenCalled();
    expect(addFileToFolder).not.toHaveBeenCalled();
  });

  it("downloads the bytes when the size is known and fine (never a bare URL)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD" || init?.headers) {
        return { ok: true, status: 200, headers: new Headers({ "content-length": "1024" }) } as unknown as Response;
      }
      return streamOf(1024, 1, { "content-type": "application/pdf" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await saveLinkOffline({
      url: "https://cdn.jsdelivr.net/ok.pdf",
      title: "Ok",
      source: "cdn",
    });
    expect(getOrCreateFolder).toHaveBeenCalledWith(OFFLINE_FOLDER);
    expect(addFileToFolder).toHaveBeenCalled();
    expect(addUrlToFolder).not.toHaveBeenCalled();
    expect((addFileToFolder.mock.calls[0][1] as File).name).toBe("ok.pdf");
    expect(res.folderName).toBe(OFFLINE_FOLDER);
  });

  it("streams with a hard cap when the host hides the size (OOM guard)", async () => {
    // HEAD/Range reveal nothing, then the body streams past the limit.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD" || init?.headers) {
        return { ok: true, status: 200, headers: new Headers() } as unknown as Response;
      }
      return streamOf(8 * 1024 * 1024, 40); // 320 MB > 200 MB cap
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      saveLinkOffline({ url: "https://cdn.jsdelivr.net/huge.pdf", title: "Huge", source: "cdn" }),
    ).rejects.toThrow(/larger than the/i);
    expect(addFileToFolder).not.toHaveBeenCalled();
    expect(addUrlToFolder).not.toHaveBeenCalled();
  });

  it("stores the streamed bytes when the unknown-size body stays under the cap", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD" || init?.headers) {
        return { ok: true, status: 200, headers: new Headers() } as unknown as Response;
      }
      return streamOf(1024, 4, { "content-type": "application/pdf" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await saveLinkOffline({
      url: "https://cdn.jsdelivr.net/small.pdf",
      title: "Small",
      source: "cdn",
    });
    expect(addFileToFolder).toHaveBeenCalled();
    const file = addFileToFolder.mock.calls[0][1] as File;
    expect(file.name).toBe("small.pdf");
    expect(file.size).toBe(4096);
    expect(res.folderName).toBe(OFFLINE_FOLDER);
  });
});

describe("fetchCapped", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null when no candidate can be streamed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("CORS"); }));
    expect(await fetchCapped("https://example.com/a.pdf", MAX)).toBeNull();
  });
});
