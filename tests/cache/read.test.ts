import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(),
}));

type Chain = {
  select: (..._: unknown[]) => Chain;
  eq: (..._: unknown[]) => Chain;
  in: (..._: unknown[]) => Chain;
  maybeSingle: () => { data: unknown };
  then: (resolve: (v: { data: unknown }) => void) => void;
};

function chain(data: unknown): Chain {
  const c: Partial<Chain> = {};
  c.select = () => c as Chain;
  c.eq = () => c as Chain;
  c.in = () => c as Chain;
  c.maybeSingle = () => ({ data });
  c.then = (resolve) => resolve({ data });
  return c as Chain;
}

describe("readCachedBlob", () => {
  beforeEach(() => vi.resetModules());

  it("returns null when row missing", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: () => chain(null),
    });
    const { readCachedBlob } = await import("@/lib/cache/read");
    const out = await readCachedBlob("p", "pulse_blob");
    expect(out).toBeNull();
  });

  it("returns payload with computed_at + age_seconds", async () => {
    const stamp = new Date(Date.now() - 60_000).toISOString();
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: () => chain({ payload: { counters: 1 }, computed_at: stamp }),
    });
    const { readCachedBlob } = await import("@/lib/cache/read");
    const out = await readCachedBlob<{ counters: number }>("p", "pulse_blob");
    expect(out).not.toBeNull();
    expect(out?.payload.counters).toBe(1);
    expect(out?.age_seconds).toBeGreaterThanOrEqual(59);
    expect(out?.age_seconds).toBeLessThan(120);
  });
});
