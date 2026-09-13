/**
 * Validates whether a URL is a safe web URL (http: or https: protocol, or safe relative path).
 * Rejects javascript:, data:, vbscript:, and other dangerous/non-web protocols.
 */
export function isSafeUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;

  const trimmed = url.trim();
  if (!trimmed) return false;

  // Handle safe relative paths (e.g. /dashboard, #section)
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) {
    // Protocol-relative URLs ("//evil.com") should be rejected as relative paths
    if (trimmed.startsWith("//")) return false;
    return true;
  }

  try {
    // Constructing URL parses protocol (e.g., 'https:', 'http:', 'javascript:') case-insensitively
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns the URL string if safe, or undefined if unsafe.
 */
export function sanitizeUrl(url?: string | null): string | undefined {
  if (!url || !isSafeUrl(url)) return undefined;
  return url.trim();
}
