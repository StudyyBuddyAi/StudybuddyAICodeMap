/**
 * Who may call the functions that exist for building and testing, not for
 * students — the staging copy of medical-notes and the provider spike.
 *
 * STAFF_USER_IDS is a comma-separated list of auth user ids, set as a
 * function secret. Unset, nobody is staff: those functions are closed to
 * everyone until someone is named, never open by default.
 */
export function staffUserIds(): string[] {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return (env?.get("STAFF_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaff(userId: string | null | undefined): boolean {
  return !!userId && staffUserIds().includes(userId.toLowerCase());
}
