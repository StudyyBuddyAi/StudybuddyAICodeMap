/**
 * Account deletion, for the in-app "Delete account" (Google Play and Apple
 * 5.1.1(v) require it inside the app). Pure request handling; the Supabase
 * calls are injected so it can be tested without a server.
 *
 * Deleting the auth user is the whole job: every table that holds a user's
 * data references auth.users with ON DELETE CASCADE (profile, decks, cards,
 * review history, study history and sheet layers, QBank sessions, answers,
 * timed selections, flags and reports, their generated questions, usage
 * and citation counts, premium grants, AI memory). Two tables keep a row
 * without the user (ON DELETE SET NULL): rag_logs (library query text and
 * which passages were used) and pro_codes (a redeemed code stays used).
 * When a new table stores user data, it must cascade too, or be added here.
 */

/** The client must send this, so a stray call can't delete an account. */
export const DELETE_CONFIRMATION = "DELETE";

export interface DeleteAccountDeps {
  /** The user the access token belongs to, or null if it isn't valid. */
  userFromToken(token: string): Promise<{ id: string } | null>;
  /** Deletes the auth user (service role); the cascade does the rest. */
  deleteUser(id: string): Promise<{ error: string | null }>;
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface DeleteAccountResult {
  status: number;
  body: { deleted: true } | { error: string };
}

export async function handleDeleteAccount(
  authorization: string | null,
  body: unknown,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResult> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { status: 401, body: { error: "invalid_token" } };

  const user = await deps.userFromToken(token);
  if (!user) return { status: 401, body: { error: "invalid_token" } };

  const confirm = (body as { confirm?: unknown } | null)?.confirm;
  if (confirm !== DELETE_CONFIRMATION) {
    return { status: 400, body: { error: "confirmation_required" } };
  }

  const { error } = await deps.deleteUser(user.id);
  if (error) {
    // Metadata only: no email, no token.
    deps.log("delete_failed", { error });
    return { status: 500, body: { error: "delete_failed" } };
  }
  deps.log("deleted");
  return { status: 200, body: { deleted: true } };
}
