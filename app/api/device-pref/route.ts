import { NextResponse } from "next/server";
import { setDevicePreference, type DeviceClass } from "@/lib/device";
import { createServerSupabase } from "@/lib/supabase/server";
import { readGuestSession } from "@/lib/auth/guest-session";

/**
 * POST /api/device-pref { device: 'mobile' | 'desktop' | null }
 *
 * Sets fs_device_pref to lock the shell to one device class regardless of
 * UA. Send null (or { clear: true }) to drop the preference and fall back
 * to UA detection. Used by:
 *   - "Open desktop dashboard" link in the mobile More menu
 *   - "Use the mobile site" link in the desktop avatar menu
 *   - the recovery escape hatches /use-mobile / /use-desktop
 *
 * Auth gate: requires either a Supabase session or a valid guest cookie.
 * fs_device_pref is otherwise sticky and tamper-resistant via SameSite=Lax,
 * but writing it for anonymous requests is a low-grade nuisance vector
 * (forcing a wrong shell view on victims via cross-site fetch). Limiting
 * to authenticated callers closes that.
 */
export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guest = user ? null : await readGuestSession();
  if (!user && !guest) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: { device?: DeviceClass | null; clear?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const device = body.clear ? null : body.device ?? null;
  if (device !== null && device !== "mobile" && device !== "desktop") {
    return NextResponse.json(
      { ok: false, error: "device must be 'mobile', 'desktop', or null" },
      { status: 400 },
    );
  }
  await setDevicePreference(device);
  return NextResponse.json({ ok: true, device });
}
