import { describe, it, expect, beforeAll } from "vitest";
import {
  encodeGuestCookie,
  decodeGuestCookie,
  _generateTestSecret,
  type GuestSession,
} from "@/lib/auth/guest-session";

const FRESH: GuestSession = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

beforeAll(() => {
  process.env.GUEST_COOKIE_SECRET = _generateTestSecret();
});

describe("guest-session cookie", () => {
  it("round-trips a valid session", () => {
    const raw = encodeGuestCookie(FRESH);
    const decoded = decodeGuestCookie(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.sessionId).toBe(FRESH.sessionId);
    expect(decoded?.projectId).toBe(FRESH.projectId);
    expect(decoded?.expiresAt).toBe(FRESH.expiresAt);
  });

  it("rejects a flipped signature byte", () => {
    const raw = encodeGuestCookie(FRESH);
    const dot = raw.lastIndexOf(".");
    const tampered = raw.slice(0, dot + 1) + flipChar(raw[dot + 1]) + raw.slice(dot + 2);
    expect(decodeGuestCookie(tampered)).toBeNull();
  });

  it("rejects a payload edited without re-signing", () => {
    const raw = encodeGuestCookie(FRESH);
    const dot = raw.lastIndexOf(".");
    // Replace just the body with a different (validly-encoded) payload.
    const other = encodeGuestCookie({ ...FRESH, projectId: "99999999-9999-9999-9999-999999999999" });
    const otherBody = other.slice(0, other.lastIndexOf("."));
    const swapped = otherBody + raw.slice(dot);
    expect(decodeGuestCookie(swapped)).toBeNull();
  });

  it("rejects an expired session", () => {
    const expired: GuestSession = {
      ...FRESH,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const raw = encodeGuestCookie(expired);
    expect(decodeGuestCookie(raw)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(decodeGuestCookie(null)).toBeNull();
    expect(decodeGuestCookie(undefined)).toBeNull();
    expect(decodeGuestCookie("")).toBeNull();
    expect(decodeGuestCookie("no-dot-here")).toBeNull();
    expect(decodeGuestCookie(".onlytag")).toBeNull();
    expect(decodeGuestCookie("onlybody.")).toBeNull();
    expect(decodeGuestCookie("not-json.deadbeef")).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const raw = encodeGuestCookie(FRESH);
    process.env.GUEST_COOKIE_SECRET = _generateTestSecret(); // rotate
    expect(decodeGuestCookie(raw)).toBeNull();
  });
});

function flipChar(c: string): string {
  // Pick any other base64url character so the result is still well-formed.
  return c === "A" ? "B" : "A";
}
