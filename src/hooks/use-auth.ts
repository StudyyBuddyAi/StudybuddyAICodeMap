/**
 * The auth state lives in a single provider (src/contexts/AuthContext.tsx) so
 * every consumer shares one session and one anonymous bootstrap. This module
 * stays at its original path so the existing "@/hooks/use-auth" imports across
 * the app keep working unchanged.
 */
export { AuthProvider, useAuth, ensureAnonSession } from "@/contexts/AuthContext";
