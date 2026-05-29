/**
 * Single source of truth for what each project role is allowed to do.
 * Consumers (server + client) import these helpers instead of inlining
 * `role === "owner" || role === "admin"` everywhere.
 *
 * Roles (project_members.role values):
 *   owner    — project creator; full control + can transfer/delete
 *   admin    — full control except delete project
 *   surveyor — collect points, edit own, edit symbology
 *   viewer   — read-only on desktop dashboard; no mobile field shell
 *   null     — no membership (anonymous or unrelated user)
 */

export type ProjectRole = "owner" | "admin" | "surveyor" | "viewer" | null;

export function canDeleteProject(role: ProjectRole): boolean {
  return role === "owner";
}
export function canEditProject(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canAccessSettings(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canImport(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canManageMembers(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canManageRecipients(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canEditPoints(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canEditOthersPoints(role: ProjectRole): boolean {
  return role === "owner" || role === "admin";
}
export function canEditSymbology(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canWriteChat(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canCollectMobile(role: ProjectRole): boolean {
  return role === "owner" || role === "admin" || role === "surveyor";
}
export function canReadProject(role: ProjectRole): boolean {
  return role !== null;
}
