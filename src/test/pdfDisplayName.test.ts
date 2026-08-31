import { describe, expect, it } from "vitest";
import { humanizeFileName, looksLikeMachineName, pdfDisplayName } from "../lib/pdfDisplayName";

describe("humanizeFileName", () => {
  it("strips path, query and extension and tidies separators", () => {
    expect(humanizeFileName("/NOTES/PROD/body_fluids-and%20circulation.pdf?x=1"))
      .toBe("body fluids - and circulation");
    expect(humanizeFileName("Plant Kingdom L03.pdf")).toBe("Plant Kingdom L03");
  });

  it("is empty for nullish input", () => {
    expect(humanizeFileName(undefined)).toBe("");
    expect(humanizeFileName(null)).toBe("");
  });
});

describe("looksLikeMachineName", () => {
  it("flags storage hashes, uuids and numeric blobs", () => {
    expect(looksLikeMachineName("6a7eb202ce63b65a22dd7742")).toBe(true);
    expect(looksLikeMachineName("3d4cc057-1a6a-461a-8d8d-3959e31d24fc")).toBe(true);
    expect(looksLikeMachineName("1723456789012")).toBe(true);
    expect(looksLikeMachineName("")).toBe(true);
  });

  it("accepts real chapter names", () => {
    expect(looksLikeMachineName("Body Fluids and Circulation")).toBe(false);
    expect(looksLikeMachineName("Plant Kingdom L03")).toBe(false);
  });
});

describe("pdfDisplayName", () => {
  it("never shows a storage hash — falls back to the lesson title", () => {
    expect(pdfDisplayName("6a7eb202ce63b65a22dd7742.pdf", [null, "Body Fluids and Circulation"]))
      .toBe("Body Fluids and Circulation");
  });

  it("prefers a readable filename over fallbacks", () => {
    expect(pdfDisplayName("Plant_Kingdom_L03.pdf", ["Zoology"])).toBe("Plant Kingdom L03");
  });

  it("ends at a generic label when everything is machine generated", () => {
    expect(pdfDisplayName("6a7eb202ce63b65a22dd7742.pdf", ["a1b2c3d4e5f67890"])).toBe("PDF Document");
  });
});
