// Canonical list lives in supabase/migrations/20260806000000_block_disposable_email_domains.sql
// Adding a domain: edit both files.

const BLOCKED_EMAIL_DOMAINS = new Set([
  "mailinator.com", "tempmail.com", "guerrillamail.com", "10minutemail.com",
  "yopmail.com", "throwawaymail.com", "trashmail.com", "sharklasers.com",
  "guerrillamailblock.com", "grr.la", "guerrillamail.info", "spam4.me",
  "fakeinbox.com", "mailnull.com", "spamgourmet.com", "trashmail.at",
  "trashmail.io", "dispostable.com", "tempr.email", "discard.email",
  "spamhereplease.com", "maildrop.cc", "getairmail.com", "filzmail.com",
  "mailscrap.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return BLOCKED_EMAIL_DOMAINS.has(domain);
}
