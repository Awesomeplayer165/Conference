import { describe, expect, it } from "bun:test";
import { generateSessionCode, isCompleteSessionCode, normalizeSessionCode } from "./sessionCode.js";

describe("share session codes", () => {
  it("generates an unambiguous grouped six-character code", () => {
    const code = generateSessionCode(new Uint32Array([0, 1, 2, 3, 4, 5]));
    expect(code).toBe("ABC-DEF");
    expect(isCompleteSessionCode(code)).toBe(true);
  });

  it("normalizes pasted and typed viewer codes", () => {
    expect(normalizeSessionCode(" abc def ")).toBe("ABC-DEF");
    expect(normalizeSessionCode("ab-c")).toBe("ABC");
    expect(isCompleteSessionCode("ABC-DE")).toBe(false);
  });
});
