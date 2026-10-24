/**
 * Whether this page load is the landing of a password-reset email link.
 *
 * Supabase sends the reader to the project's Site URL — the landing page —
 * whenever the requested redirect (/reset-password) is not on the project's
 * allow-list, with the recovery tokens in the URL fragment. supabase-js reads
 * and clears that fragment as soon as the client is created, so it is captured
 * here first: main.tsx imports this module before anything that creates the
 * client. The app then routes the reader to /reset-password wherever they land.
 */
const RECOVERY_KEY = "sb_recovery_pending";

function readFragment(): boolean {
  if (typeof window === "undefined") return false;
  const { hash, search } = window.location;
  return /(^|[#&?])type=recovery(&|$)/.test(hash) || /(^|[?&])type=recovery(&|$)/.test(search);
}

try {
  if (readFragment()) sessionStorage.setItem(RECOVERY_KEY, "1");
} catch {
  /* storage unavailable: the PASSWORD_RECOVERY event still routes the reader */
}

export function isRecoveryPending(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

export function markRecoveryPending(): void {
  try {
    sessionStorage.setItem(RECOVERY_KEY, "1");
  } catch {
    /* see above */
  }
}

export function clearRecoveryPending(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* see above */
  }
}
