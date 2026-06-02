import { describe, expect, it } from "vitest";
import {
  desktopProjectUrl,
  mobileProjectUrl,
  parseProjectPath,
  targetForDevice,
} from "@/lib/mobile/surface-map";

describe("parseProjectPath", () => {
  it("parses a desktop project surface", () => {
    expect(parseProjectPath("/p/abc/map")).toEqual({
      projectId: "abc",
      surface: "map",
      isMobile: false,
      trailingSlash: false,
    });
  });
  it("parses a mobile project surface", () => {
    expect(parseProjectPath("/p/abc/m/chat")).toEqual({
      projectId: "abc",
      surface: "chat",
      isMobile: true,
      trailingSlash: false,
    });
  });
  it("preserves trailing slash awareness", () => {
    expect(parseProjectPath("/p/abc/map/")?.trailingSlash).toBe(true);
  });
  it("returns null for non-project paths", () => {
    expect(parseProjectPath("/home")).toBeNull();
    expect(parseProjectPath("/sign-in")).toBeNull();
    expect(parseProjectPath("/p/abc")).toBeNull();
    expect(parseProjectPath("/p/abc/m")).toBeNull();
  });
  it("handles project ids with hyphens / uuids", () => {
    const out = parseProjectPath("/p/24c6e5d4-6a51-4be9-8d4f-1ab/map");
    expect(out?.projectId).toBe("24c6e5d4-6a51-4be9-8d4f-1ab");
    expect(out?.surface).toBe("map");
  });
  it("strips query string before matching the surface", () => {
    expect(parseProjectPath("/p/X/map?foo=bar")?.surface).toBe("map");
    expect(parseProjectPath("/p/X/m/survey?q=1")?.surface).toBe("survey");
  });
  it("strips fragment before matching the surface", () => {
    expect(parseProjectPath("/p/X/map#anchor")?.surface).toBe("map");
  });
});

describe("targetForDevice", () => {
  const cases: Array<[string, "mobile" | "desktop", string | null]> = [
    // mobile UA visiting desktop URLs → forwarded to mobile
    ["/p/X/map", "mobile", "/p/X/m/map"],
    ["/p/X/points", "mobile", "/p/X/m/points"],
    ["/p/X/responses", "mobile", "/p/X/m/survey"],
    ["/p/X/members", "mobile", "/p/X/m/members"],
    ["/p/X/settings", "mobile", "/p/X/m/settings"],
    ["/p/X/import", "mobile", "/p/X/m/import"],
    // desktop UA visiting mobile URLs that have a desktop equivalent
    ["/p/X/m/map", "desktop", "/p/X/map"],
    ["/p/X/m/points", "desktop", "/p/X/points"],
    ["/p/X/m/survey", "desktop", "/p/X/responses"],
    ["/p/X/m/members", "desktop", "/p/X/members"],
    ["/p/X/m/settings", "desktop", "/p/X/settings"],
    ["/p/X/m/import", "desktop", "/p/X/import"],
    // mobile-only surfaces stay put on desktop (we render them, not redirect)
    ["/p/X/m/chat", "desktop", null],
    ["/p/X/m/report", "desktop", null],
    ["/p/X/m/more", "desktop", null],
    ["/p/X/m/analysis", "desktop", null],
    // already-correct paths: no redirect
    ["/p/X/map", "desktop", null],
    ["/p/X/m/map", "mobile", null],
    // non-project paths: no redirect
    ["/home", "mobile", null],
    ["/sign-in", "desktop", null],
    ["/api/foo", "mobile", null],
  ];
  it.each(cases)("(%s, %s) -> %s", (path, device, expected) => {
    expect(targetForDevice(path, device)).toBe(expected);
  });
});

describe("URL builders", () => {
  it("desktopProjectUrl", () => {
    expect(desktopProjectUrl("abc", "map")).toBe("/p/abc/map");
    expect(desktopProjectUrl("abc", "responses")).toBe("/p/abc/responses");
  });
  it("mobileProjectUrl", () => {
    expect(mobileProjectUrl("abc", "map")).toBe("/p/abc/m/map");
    expect(mobileProjectUrl("abc", "chat")).toBe("/p/abc/m/chat");
    expect(mobileProjectUrl("abc", "report")).toBe("/p/abc/m/report");
  });
});
