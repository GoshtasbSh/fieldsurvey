import { CANONICAL_STATUS_COLORS, categorizeStatus, type CanonicalStatus } from "@/lib/match/status-categorize";

type ProjectStatus = { id: string; label: string };

/**
 * Make sure project_statuses has a row for every canonical bucket present
 * in the supplied free-form labels. Missing buckets get created with the
 * Keystone palette color so the canvass-CSV import always lands every row
 * in a valid status_id.
 *
 * Returns the up-to-date labelLower → id map.
 */
export async function ensureCanonicalStatuses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  projectId: string,
  freeformLabels: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  // Existing rows
  const { data: existing } = await sb
    .from("project_statuses")
    .select("id, label, sort_order")
    .eq("project_id", projectId)
    .order("sort_order") as { data: Array<{ id: string; label: string; sort_order: number }> | null };

  const labelLowerToId = new Map<string, string>();
  let maxSort = -1;
  for (const s of existing ?? []) {
    labelLowerToId.set(s.label.toLowerCase(), s.id);
    if (s.sort_order > maxSort) maxSort = s.sort_order;
  }

  // Which canonical buckets do these CSV rows need?
  const need = new Set<CanonicalStatus>();
  for (const l of freeformLabels) need.add(categorizeStatus(l));

  const toCreate: Array<{ project_id: string; label: string; color: string; sort_order: number; is_default: boolean }> = [];
  for (const cat of need) {
    if (labelLowerToId.has(cat.toLowerCase())) continue;
    // Skip auto-creating "Unknown" — it's the sentinel for "no rule matched"
    // and shouldn't pollute the user's status palette.
    if (cat === "Unknown") continue;
    maxSort += 1;
    toCreate.push({
      project_id: projectId,
      label: cat,
      color: CANONICAL_STATUS_COLORS[cat],
      sort_order: maxSort,
      is_default: false,
    });
  }

  if (toCreate.length > 0) {
    const { data: inserted } = await sb
      .from("project_statuses")
      .insert(toCreate)
      .select("id, label") as { data: ProjectStatus[] | null };
    for (const s of inserted ?? []) labelLowerToId.set(s.label.toLowerCase(), s.id);
  }

  return labelLowerToId;
}
