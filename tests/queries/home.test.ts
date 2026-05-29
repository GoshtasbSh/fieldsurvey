import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(),
}));

type Chain = {
  select: (..._: unknown[]) => Chain;
  eq: (..._: unknown[]) => Chain;
  in: (..._: unknown[]) => Chain;
  order: (..._: unknown[]) => Chain;
  then: (resolve: (v: { data: unknown }) => void) => void;
};

function chain(data: unknown): Chain {
  const obj: Partial<Chain> = {};
  const c = (() => obj) as unknown as Chain["select"];
  obj.select = c;
  obj.eq = c;
  obj.in = c;
  obj.order = c;
  obj.then = (resolve) => resolve({ data });
  return obj as Chain;
}

describe("listHomeCards", () => {
  beforeEach(() => vi.resetModules());

  it("returns empty buckets when no user", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => chain([]),
    });
    const { listHomeCards } = await import("@/lib/queries/home");
    const out = await listHomeCards();
    expect(out).toEqual({ owned: [], shared: [], drafts: [] });
  });

  it("returns empty buckets when no projects", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => chain([]),
    });
    const { listHomeCards } = await import("@/lib/queries/home");
    const out = await listHomeCards();
    expect(out.owned).toHaveLength(0);
    expect(out.shared).toHaveLength(0);
    expect(out.drafts).toHaveLength(0);
  });
});
