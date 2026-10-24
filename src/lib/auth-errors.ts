/**
 * Supabase Auth messages, turned into what a student should read.
 *
 * Two rules: never say whether an email has an account (sign-in and sign-up
 * get the same "email or password" line), and never show a raw provider
 * message — anything unrecognised becomes a plain retry.
 */
export function friendlyAuthError(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return "Something went wrong. Please try again.";
  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid credentials") ||
    m.includes("already registered") ||
    m.includes("already been registered") ||
    m.includes("already exists") ||
    m.includes("user not found")
  ) {
    return "The email or password is incorrect.";
  }
  if (m.includes("token has expired") || m.includes("otp") || m.includes("invalid token")) {
    return "That code is incorrect or has expired. Check it, or request a new code.";
  }
  if (m.includes("email not confirmed")) {
    return "Please verify your email first — check your inbox for the code.";
  }
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (m.includes("longer than") || m.includes("too long")) {
    return `That password is too long — use at most ${PASSWORD_MAX} characters.`;
  }
  if (m.includes("password should contain") || m.includes("characters of each")) {
    return "Choose a stronger password — mix letters and numbers.";
  }
  if (m.includes("password should be") || m.includes("weak password") || m.includes("pwned") || m.includes("at least")) {
    return `Choose a stronger password — at least ${PASSWORD_MIN} characters, and not a common one.`;
  }
  if (m.includes("should be different") || m.includes("same password")) {
    return "Choose a password you haven't used for this account before.";
  }
  if (m.includes("invalid format") || m.includes("is invalid") || m.includes("validate email")) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (m.includes("sending") || m.includes("smtp") || m.includes("send email") || m.includes("confirmation email")) {
    return "We couldn't send the email just now. Wait a minute and try again.";
  }
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) {
    return "New sign-ups are paused right now. Please try again later.";
  }
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("fetch")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (m.includes("permanent email")) return message as string;
  return "Something went wrong on our side. Please try again in a minute.";
}

/** Supabase's minimum, and bcrypt's 72-byte ceiling, which GoTrue enforces. */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;

/** The reason a new password can't be used, checked before anything is sent. */
export function passwordRequirementError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Your password needs at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) {
    return `That password is too long — use at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}
