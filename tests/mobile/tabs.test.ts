import { describe, expect, it } from "vitest";
import {
  isSurfaceAllowed,
  SURFACES_BY_ROLE,
  tabsForRole,
  TABS_BY_ROLE,
} from "@/lib/mobile/tabs";

describe("TABS_BY_ROLE", () => {
  it("admin sees 5 tabs in spec order", () => {
    expect(TABS_BY_ROLE.admin).toEqual(["map", "points", "survey", "chat", "more"]);
  });
  it("member sees 4 tabs (no more)", () => {
    expect(TABS_BY_ROLE.member).toEqual(["map", "points", "survey", "chat"]);
  });
  it("guest sees 3 tabs (no points/survey/more)", () => {
    expect(TABS_BY_ROLE.guest).toEqual(["map", "chat", "report"]);
  });
});

describe("tabsForRole hydrates metadata", () => {
  it.each(["admin", "member", "guest"] as const)("%s tabs have matching metadata", (role) => {
    const tabs = tabsForRole(role);
    expect(tabs).toHaveLength(TABS_BY_ROLE[role].length);
    tabs.forEach((t) => {
      expect(t.label).toBeTruthy();
      expect(t.iconKey).toBeTruthy();
      expect(t.id).toBeTruthy();
    });
  });
});

describe("SURFACES_BY_ROLE — role gate matrix", () => {
  // admin can render everything except guest-only "report"
  it("admin can render every admin/member surface", () => {
    [
      "map", "points", "survey", "chat", "more",
      "analysis", "members", "settings", "import", "reports", "add",
    ].forEach((s) => expect(isSurfaceAllowed("admin", s as never)).toBe(true));
  });
  it("admin cannot render 'report' (guest-only)", () => {
    expect(isSurfaceAllowed("admin", "report")).toBe(false);
  });
  it("member cannot render admin-only surfaces", () => {
    ["more", "analysis", "members", "settings", "import", "reports", "report"].forEach((s) =>
      expect(isSurfaceAllowed("member", s as never)).toBe(false),
    );
  });
  it("guest cannot render anything except map/chat/report/add", () => {
    expect(isSurfaceAllowed("guest", "map")).toBe(true);
    expect(isSurfaceAllowed("guest", "chat")).toBe(true);
    expect(isSurfaceAllowed("guest", "report")).toBe(true);
    expect(isSurfaceAllowed("guest", "add")).toBe(true);
    ["points", "survey", "more", "analysis", "members", "settings", "import", "reports"].forEach(
      (s) => expect(isSurfaceAllowed("guest", s as never)).toBe(false),
    );
  });
});

describe("matrix is consistent — every tabsForRole surface is in SURFACES_BY_ROLE", () => {
  it.each(["admin", "member", "guest"] as const)("%s tabs ⊆ surfaces", (role) => {
    TABS_BY_ROLE[role].forEach((s) => expect(SURFACES_BY_ROLE[role].has(s)).toBe(true));
  });
});
