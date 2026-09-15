/**
 * The eval harness's identity: one anonymous user, created once and reused.
 *
 * medical-notes-corti unlocks eval mode only for user ids on its EVAL_USER_IDS
 * allowlist, so the credential is this user's session. It is stored outside the
 * repo (NOTES_EVAL_SESSION, default ~/.studybuddy-notes-eval-session.json) and
 * refreshed on every run, so the access token is always fresh.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export function loadDotEnv(root: string): void {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SESSION_FILE =
  process.env.NOTES_EVAL_SESSION ?? path.join(os.homedir(), ".studybuddy-notes-eval-session.json");

export async function getEvalSession(): Promise<{ accessToken: string; userId: string }> {
  const url = process.env.VITE_SUPABASE_URL!;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (fs.existsSync(SESSION_FILE)) {
    const saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: saved.refresh_token });
    if (!error && data.session) {
      fs.writeFileSync(SESSION_FILE, JSON.stringify({ refresh_token: data.session.refresh_token }));
      return { accessToken: data.session.access_token, userId: data.session.user.id };
    }
    throw new Error(`stored eval session could not be refreshed: ${error?.message}. Delete ${SESSION_FILE} and re-allowlist the new user id.`);
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ refresh_token: data.session.refresh_token }));
  return { accessToken: data.session.access_token, userId: data.session.user.id };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  loadDotEnv(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "../.."));
  const { userId } = await getEvalSession();
  console.log(`eval user id: ${userId}`);
}
