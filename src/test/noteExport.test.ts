import { describe, it, expect, beforeEach } from "vitest";
import { noteFilename, buildObsidianUri, getVault, setVault, OBSIDIAN_URI_LIMIT } from "../lib/reader/noteExport";

describe("note export", () => {
  beforeEach(() => localStorage.clear());

  it("builds a safe markdown filename from the doc title", () => {
    expect(noteFilename("NCERT Example.pdf")).toBe("NCERT Example.md");
    expect(noteFilename("Bio/Chem: notes?")).toBe("Bio Chem notes.md");
    expect(noteFilename("")).toBe("note.md");
  });

  it("encodes the obsidian uri fully", () => {
    const uri = buildObsidianUri("My Vault", "Unit 1", "# hi\nfoo & bar");
    expect(uri).toBe("obsidian://new?vault=My%20Vault&file=Unit%201&content=%23%20hi%0Afoo%20%26%20bar");
  });

  it("remembers the vault name", () => {
    expect(getVault()).toBeNull();
    setVault("  StudyVault ");
    expect(getVault()).toBe("StudyVault");
  });

  it("keeps a sane uri length limit so long notes fall back to .md", () => {
    const long = "x".repeat(OBSIDIAN_URI_LIMIT + 1);
    expect(buildObsidianUri("v", "t", long).length).toBeGreaterThan(OBSIDIAN_URI_LIMIT);
  });
});

describe("obsidian conventions", () => {
  it("adds a properties block and keeps an existing one", async () => {
    const { withFrontmatter } = await import("../lib/reader/noteExport");
    const out = withFrontmatter("hello", { title: "Unit 1", page: 3 });
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain('title: "Unit 1"');
    expect(out).toContain("page: 3");
    expect(out.trimEnd().endsWith("hello")).toBe(true);
    expect(withFrontmatter("---\ntitle: mine\n---\nbody")).toContain("title: mine");
  });

  it("puts the note inside the chosen vault folder", async () => {
    const { buildObsidianUri, setVaultFolder, getVaultFolder } = await import("../lib/reader/noteExport");
    setVaultFolder("/PDF Notes/");
    expect(getVaultFolder()).toBe("PDF Notes");
    expect(buildObsidianUri("V", "Unit 1", "x", "PDF Notes")).toContain("file=PDF%20Notes%2FUnit%201");
  });
});

describe("kepano formatting helpers", () => {
  it("normalises bullets, headings and trailing space", async () => {
    const { normalizeMarkdown } = await import("../lib/reader/noteExport");
    expect(normalizeMarkdown("* one  \n+ two\n##Head\n\n\n\nend  ")).toBe(
      "- one\n- two\n## Head\n\nend\n",
    );
  });

  it("merges only the missing properties into existing frontmatter", async () => {
    const { withFrontmatter } = await import("../lib/reader/noteExport");
    const out = withFrontmatter("---\ntitle: mine\n---\nbody", { title: "Other" });
    expect(out).toContain("title: mine");
    expect(out).not.toContain('title: "Other"');
    expect(out).toContain("source: Naveen Bharat");
    expect(out.trimEnd().endsWith("body")).toBe(true);
  });

  it("builds an obsidian open uri for the same path", async () => {
    const { buildObsidianOpenUri } = await import("../lib/reader/noteExport");
    expect(buildObsidianOpenUri("V", "Unit 1", "PDF Notes")).toBe(
      "obsidian://open?vault=V&file=PDF%20Notes%2FUnit%201",
    );
  });
});
