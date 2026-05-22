import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
});

describe("createBrowserSupabase", () => {
  it("returns a client with auth and from() available", async () => {
    const { createBrowserSupabase } = await import("./client");
    const client = createBrowserSupabase();
    expect(typeof client.auth.getSession).toBe("function");
    expect(typeof client.from).toBe("function");
  });
});
