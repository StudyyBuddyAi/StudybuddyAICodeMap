/**
 * The auth state lives in a single provider (src/contexts/AuthContext.tsx) so
 * every consumer shares one session. This module stays at its original path
 * so the existing "@/hooks/use-auth" imports across the app keep working
 * unchanged.
 */
export { AuthProvider, useAuth } from "@/contexts/AuthContext";
