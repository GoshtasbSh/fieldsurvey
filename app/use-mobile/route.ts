import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEVICE_PREF_COOKIE } from "@/lib/device";

/**
 * Recovery route — clears the device preference cookie so a user who got
 * stuck on the wrong shell (e.g. set "desktop" on a phone and can no longer
 * reach Sign out) can drop back to OS-driven device detection.
 *
 * Visit /use-mobile on the phone to wipe the override and land on /home,
 * which will then route by User-Agent.
 */
export async function GET() {
  const jar = await cookies();
  jar.delete(DEVICE_PREF_COOKIE);
  return NextResponse.redirect(new URL("/home", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
