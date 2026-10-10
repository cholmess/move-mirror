import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { assertNoBroadWhitelistPatterns } from "./i18n-lib.mjs";

describe("i18n whitelist guard", () => {
  it("rejects broad patterns like technical:* or common:*", () => {
    const source = readFileSync(new URL("./i18n-lib.mjs", import.meta.url), "utf8");
    assertNoBroadWhitelistPatterns(source);
    expect(() => assertNoBroadWhitelistPatterns("whitelist: technical:*")).toThrow(/Forbidden broad/);
    expect(() => assertNoBroadWhitelistPatterns("whitelist: common:*")).toThrow(/Forbidden broad/);
    expect(() => assertNoBroadWhitelistPatterns('keyPath.startsWith("technical.")')).toThrow(/Forbidden broad/);
  });
});
