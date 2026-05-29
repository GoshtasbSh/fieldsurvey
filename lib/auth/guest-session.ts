/**
 * Guest-session cookie helpers (M5).
 *
 * Background:
 *   FieldSurvey supports "guest mode" — an admin issues a 24-hour day-code,
 *   a surveyor enters it on the sign-in page, and from that moment they can
 *   collect points without a Supabase account. The day-code lookup happens
 *   once on /api/guest/start; after that, the guest's identity rides in a
 *   single HMAC-signed httpOnly cookie. Subsequent guest writes
 *   (POST /api/points/guest) re-validate the cookie and route through a
 *   service-role Supabase client so RLS doesn't have to know about guests.
 *
 * Why HMAC instead of a DB lookup per request:
 *   The cookie payload (sessionId + projectId + expiresAt) is tiny, fully
 *   server-controlled, and tamper-evident via HMAC-SHA256. We avoid hitting
 *   Postgres on every photo upload / point insert just to confirm the guest
 *   is still legit; the expires_at check is enforced both here AND in the
 *   guest-sessions RLS / RPC, so a stolen cookie can't outlive its code.
 *
 * Why no JWT library:
 *   The payload is fixed and tiny. Hand-rolling HMAC-SHA256 over a
 *   url-safe base64 JSON blob keeps the dependency surface at zero and the
 *   code small enough to audit in a single screen.
 */

import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const GUEST_COOKIE_NAME = "fs_guest";

export type GuestSession = {
  sessionId: string;
  projectId: string;
  expiresAt: string; // ISO timestamp
};

type CookiePayload = GuestSession & { iat: number };

function getSecret(): Buffer {
  const raw = process.env.GUEST_COOKIE_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "GUEST_COOKIE_SECRET is missing or shorter than 32 chars. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(raw, "utf8");
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  return b64urlEncode(createHmac("sha256", getSecret()).update(payload).digest());
}

/**
 * Encode a guest session into a `payload.signature` cookie value.
 * The body is base64url(JSON(payload)); the tag is base64url(HMAC-SHA256).
 */
export function encodeGuestCookie(s: GuestSession): string {
  const payload: CookiePayload = { ...s, iat: Date.now() };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const tag = sign(body);
  return `${body}.${tag}`;
}

/**
 * Reverse of encodeGuestCookie.
 * Returns null on any failure — bad shape, bad signature, expired session.
 * Callers MUST treat null as "no guest" and respond accordingly.
 */
export function decodeGuestCookie(raw: string | undefined | null): GuestSession | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const body = raw.slice(0, dot);
  const tag = raw.slice(dot + 1);

  // Constant-time signature comparison.
  const expected = sign(body);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: CookiePayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8")) as CookiePayload;
  } catch {
    return null;
  }
  if (
    typeof payload.sessionId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.expiresAt !== "string"
  ) {
    return null;
  }
  if (Date.parse(payload.expiresAt) <= Date.now()) return null;

  return {
    sessionId: payload.sessionId,
    projectId: payload.projectId,
    expiresAt: payload.expiresAt,
  };
}

// ── Request-scoped helpers (Next.js cookies() API) ─────────────────────────

/**
 * Read the current guest session from the request cookies. Null if absent,
 * tampered with, or expired.
 */
export async function readGuestSession(): Promise<GuestSession | null> {
  const store = await cookies();
  const raw = store.get(GUEST_COOKIE_NAME)?.value;
  return decodeGuestCookie(raw);
}

/**
 * Persist a guest session as an httpOnly cookie. The cookie's maxAge tracks
 * the session's expires_at so the browser drops it automatically when the
 * day-code expires.
 */
export async function setGuestSession(s: GuestSession): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(0, Math.floor((Date.parse(s.expiresAt) - Date.now()) / 1000));
  store.set(GUEST_COOKIE_NAME, encodeGuestCookie(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function clearGuestSession(): Promise<void> {
  const store = await cookies();
  store.set(GUEST_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Used in tests to generate a one-off secret for the encode/decode round-trip
 * without touching the real env. Not exported from any production code path.
 */
export function _generateTestSecret(): string {
  return randomBytes(32).toString("hex");
}
