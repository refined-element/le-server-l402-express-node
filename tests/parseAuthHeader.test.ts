import { describe, expect, it } from "vitest";
import { parseAuthHeader } from "../src/parseAuthHeader.js";

describe("parseAuthHeader", () => {
  it("parses a standard L402 credential", () => {
    expect(parseAuthHeader("L402 AgELbWFjYXJvb24=:deadbeef".repeat(1))).toEqual({
      macaroon: "AgELbWFjYXJvb24=",
      preimage: "deadbeef",
    });
  });

  it("accepts case-insensitive scheme", () => {
    expect(parseAuthHeader("l402 mac:pre")).toEqual({
      macaroon: "mac",
      preimage: "pre",
    });
    expect(parseAuthHeader("L402 mac:pre")).toEqual({
      macaroon: "mac",
      preimage: "pre",
    });
    expect(parseAuthHeader("LSAT mac:pre")).toBeNull();
  });

  it("tolerates leading/trailing whitespace", () => {
    expect(parseAuthHeader("  L402 mac:pre  ")).toEqual({
      macaroon: "mac",
      preimage: "pre",
    });
  });

  it("returns null for missing colon", () => {
    expect(parseAuthHeader("L402 macnopreimage")).toBeNull();
  });

  it("returns null when macaroon is empty (leading colon)", () => {
    expect(parseAuthHeader("L402 :preimage")).toBeNull();
  });

  it("returns null when preimage is empty (trailing colon)", () => {
    expect(parseAuthHeader("L402 macaroon:")).toBeNull();
  });

  it("returns null for non-L402 schemes", () => {
    expect(parseAuthHeader("Bearer abc123")).toBeNull();
    expect(parseAuthHeader("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null for undefined/null/empty input", () => {
    expect(parseAuthHeader(undefined)).toBeNull();
    expect(parseAuthHeader(null)).toBeNull();
    expect(parseAuthHeader("")).toBeNull();
    expect(parseAuthHeader("   ")).toBeNull();
  });

  it("handles base64 padding in macaroon (= chars)", () => {
    expect(parseAuthHeader("L402 AgEL==:deadbeef")).toEqual({
      macaroon: "AgEL==",
      preimage: "deadbeef",
    });
  });

  it("splits on FIRST colon only — macaroons don't contain colons but be safe", () => {
    // Real macaroons are base64 (no colons), but if a future format
    // included colons in the macaroon side we'd still get sensible
    // parsing. The first colon is always the separator.
    const result = parseAuthHeader("L402 foo:bar:baz");
    expect(result).toEqual({ macaroon: "foo", preimage: "bar:baz" });
  });
});
