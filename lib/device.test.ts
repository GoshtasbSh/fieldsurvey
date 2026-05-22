import { describe, it, expect } from "vitest";
import { isMobileUserAgent, detectOS } from "./device";

describe("isMobileUserAgent", () => {
  it("matches iPhone", () => expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0...)")).toBe(true));
  it("matches Android", () => expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14...)")).toBe(true));
  it("does NOT match macOS Safari", () => expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false));
});

describe("detectOS", () => {
  it("ios", () => expect(detectOS("iPhone")).toBe("ios"));
  it("android", () => expect(detectOS("Android")).toBe("android"));
  it("macos", () => expect(detectOS("Macintosh")).toBe("macos"));
  it("windows", () => expect(detectOS("Windows NT 10.0")).toBe("windows"));
  it("other", () => expect(detectOS("CrOS x86_64")).toBe("other"));
});
