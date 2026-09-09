/**
 * Canonical origin used to build redirect links in auth flows (password
 * reset, OAuth callbacks). VITE_SITE_URL is optional — when unset, the
 * current origin is correct for local dev and preview deploys. Without this
 * fallback, an unset VITE_SITE_URL produces "undefined/reset-password" links.
 */
export function siteUrl(): string {
  return import.meta.env.VITE_SITE_URL || window.location.origin;
}
