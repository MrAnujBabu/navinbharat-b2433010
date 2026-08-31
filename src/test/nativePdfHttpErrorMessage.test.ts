import { describe, expect, it } from "vitest";
import { errorMessageFrom } from "@/lib/nativePdfHttp";

const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64");

describe("errorMessageFrom", () => {
  it("reads the proxy reason from a parsed object", () => {
    expect(errorMessageFrom({ error: "URL not allowed" })).toBe("URL not allowed");
  });

  it("reads the reason from a JSON string body", () => {
    expect(errorMessageFrom('{"error":"Valid Drive file id is required"}')).toBe(
      "Valid Drive file id is required",
    );
  });

  it("reads the reason from a base64 arraybuffer body", () => {
    expect(errorMessageFrom(b64('{"message":"Not authorized for this file"}'))).toBe(
      "Not authorized for this file",
    );
  });

  it("returns undefined for binary or empty payloads", () => {
    expect(errorMessageFrom("")).toBeUndefined();
    expect(errorMessageFrom(b64("%PDF-1.7 binary"))).toBeUndefined();
    expect(errorMessageFrom(null)).toBeUndefined();
  });

  it("caps a very long reason", () => {
    const long = "x".repeat(500);
    expect(errorMessageFrom({ error: long })?.length).toBe(200);
  });
});
