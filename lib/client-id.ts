/**
 * Generate an idempotency key for a point created in the PWA.
 * Used as `points.client_id` (unique per project) so re-uploads from the
 * outbox cannot create duplicates.
 */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for very old browsers
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
