import { describe, it, expect } from "vitest";
import * as R from "@/lib/auth/role";

describe("role helpers", () => {
  it("owner can do everything destructive", () => {
    expect(R.canDeleteProject("owner")).toBe(true);
    expect(R.canEditProject("owner")).toBe(true);
    expect(R.canManageMembers("owner")).toBe(true);
    expect(R.canManageRecipients("owner")).toBe(true);
    expect(R.canCollectMobile("owner")).toBe(true);
  });

  it("admin can do everything except delete project", () => {
    expect(R.canDeleteProject("admin")).toBe(false);
    expect(R.canEditProject("admin")).toBe(true);
    expect(R.canManageMembers("admin")).toBe(true);
    expect(R.canCollectMobile("admin")).toBe(true);
  });

  it("surveyor can collect + edit own + symbology, not admin scopes", () => {
    expect(R.canCollectMobile("surveyor")).toBe(true);
    expect(R.canEditSymbology("surveyor")).toBe(true);
    expect(R.canEditPoints("surveyor")).toBe(true);
    expect(R.canEditOthersPoints("surveyor")).toBe(false);
    expect(R.canWriteChat("surveyor")).toBe(true);
    expect(R.canManageMembers("surveyor")).toBe(false);
    expect(R.canAccessSettings("surveyor")).toBe(false);
    expect(R.canImport("surveyor")).toBe(false);
  });

  it("viewer can do nothing destructive", () => {
    expect(R.canEditProject("viewer")).toBe(false);
    expect(R.canEditPoints("viewer")).toBe(false);
    expect(R.canEditSymbology("viewer")).toBe(false);
    expect(R.canWriteChat("viewer")).toBe(false);
    expect(R.canCollectMobile("viewer")).toBe(false);
    expect(R.canAccessSettings("viewer")).toBe(false);
    expect(R.canReadProject("viewer")).toBe(true);
  });

  it("unauthenticated null is locked out of everything", () => {
    expect(R.canEditPoints(null)).toBe(false);
    expect(R.canEditSymbology(null)).toBe(false);
    expect(R.canCollectMobile(null)).toBe(false);
    expect(R.canReadProject(null)).toBe(false);
  });
});
