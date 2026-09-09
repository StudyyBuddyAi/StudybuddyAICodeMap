import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isDisposableEmail } from "@/lib/email-domains";
import { siteUrl } from "@/lib/site-url";
import {
  applyAnonUsage,
  runPostUpgradeMigrations,
  snapshotAnonUsage,
  stashPendingUpgrade,
  clearPendingUpgrade,
} from "@/lib/auth-upgrade";

/**
 * Routes that receive a real session from an out-of-band redirect (the OAuth
 * callback, a password-reset link). Bootstrapping an anonymous session while
 * one of those is still settling races the incoming real session, so the
 * bootstrap is suppressed until the app navigates away from them.
 */
const AUTH_LANDING_ROUTES = ["/auth/callback", "/reset-password"];

/**
 * Anonymous sign-in, deduplicated across every caller. Previously each
 * component that mounted while the session was empty fired its own
 * signInAnonymously(), which minted a throwaway anonymous user per component
 * and could trip GoTrue's per-IP anonymous sign-in rate limit. Once that limit
 * trips the session stays null and isAnonymous silently becomes false,
 * degrading every `!!userId && !isAnonymous` entitlement gate.
 */
let anonSignIn: Promise<unknown> | null = null;

export function ensureAnonSession(): Promise<unknown> {
  if (!anonSignIn) {
    anonSignIn = supabase.auth.signInAnonymously().finally(() => {
      anonSignIn = null;
    });
  }
  return anonSignIn;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAnonymous: boolean;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; needsVerification: boolean; email?: string }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
  resetPasswordForEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  verifyOtp: (
    email: string,
    token: string,
    password: string,
    type?: "signup" | "email_change",
  ) => Promise<{ error: string | null }>;
  resendSignUpOtp: (
    email: string,
    type?: "signup" | "email_change",
  ) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const { pathname } = useLocation();
  const onAuthLanding = AUTH_LANDING_ROUTES.some((route) => pathname.startsWith(route));

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);

      // If user confirms email via magic link, event will be USER_UPDATED
      // The session will be refreshed automatically by Supabase
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Every visitor gets a session: anonymous until they upgrade. Kept separate
  // from the effect above so it also covers a session that goes away later
  // (sign-out), and so leaving an auth landing route re-arms it.
  useEffect(() => {
    if (loading || session || onAuthLanding) return;
    ensureAnonSession();
  }, [loading, session, onAuthLanding]);

  const isAnonymous = Boolean(session?.user?.is_anonymous);

  const signUp = async (
    email: string,
    password: string
  ): Promise<{ error: string | null; needsVerification: boolean; email?: string }> => {
    if (isDisposableEmail(email)) {
      return { error: "Please use a permanent email address.", needsVerification: false };
    }

    // Signup is two-phase because GoTrue refuses to set a password on an anonymous
    // user: updateUser({ email }) writes to `email_change` (not `email`) and leaves
    // is_anonymous true until the OTP is confirmed. The password is applied in
    // verifyOtp, once the user is no longer anonymous.
    if (isAnonymous) {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) return { error: error.message, needsVerification: false };
      return { error: null, needsVerification: true, email };
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      // Check if error indicates email already registered
      if (error.message.includes("already registered") || error.message.includes("already exists")) {
        return { error: "An account with this email already exists", needsVerification: false };
      }
      return { error: error.message, needsVerification: false };
    }
    // If no session returned, email confirmation is required
    const needsVerification = !data.session;
    return { error: null, needsVerification, email: data.user?.email };
  };

  const verifyOtp = async (
    email: string,
    token: string,
    password: string,
    type: "signup" | "email_change" = "signup"
  ): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type });
    if (error) return { error: error.message };

    // The anonymous-upgrade path above could not set the password before
    // verification, so apply it now that the user is no longer anonymous.
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) return { error: passwordError.message };

    const { data: { user: confirmedUser } } = await supabase.auth.getUser();
    const uid = confirmedUser?.id;

    if (uid) {
      await runPostUpgradeMigrations(uid);
    }

    return { error: null };
  };

  const resendSignUpOtp = async (
    email: string,
    type: "signup" | "email_change" = "signup"
  ): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.resend({ type, email });
    return { error: error?.message ?? null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const anonUserId = session?.user?.is_anonymous ? session.user.id : null;
    const today = new Date().toISOString().split("T")[0];

    const anonUsage = anonUserId ? await snapshotAnonUsage(anonUserId, today) : [];

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    if (anonUsage.length > 0) {
      const { data: { user: realUser } } = await supabase.auth.getUser();
      const realUserId = realUser?.id;
      if (realUserId) {
        await applyAnonUsage(realUserId, anonUserId, anonUsage, today);
      }
    }

    return { error: null };
  };

  // Google OAuth is a full-page redirect: the tab's JS state (and the anon
  // session) is gone by the time the browser comes back. The usage snapshot
  // and returnTo path are stashed in sessionStorage here and consumed by
  // AuthCallback once the new session exists.
  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    const anonUserId = session?.user?.is_anonymous ? session.user.id : null;
    const returnTo = window.location.pathname + window.location.search;
    await stashPendingUpgrade(anonUserId, returnTo);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${siteUrl()}/auth/callback` },
    });
    if (error) {
      clearPendingUpgrade();
      return { error: error.message };
    }
    // Navigation to Google is underway; there is nothing left to clean up here.
    return { error: null };
  };

  // Re-establish an anonymous session immediately: without a JWT the app is
  // left on an app route where every RLS-backed query fails until a reload.
  // This runs even when signOut() reports an error, because supabase-js still
  // drops the local session on most failing sign-outs (an already-expired JWT
  // returning 403, say) — the error path is exactly when it is needed most.
  const signOut = async (): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signOut();
    await ensureAnonSession();
    return { error: error?.message ?? null };
  };

  const resetPasswordForEmail = async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/reset-password`,
    });
    return { error: error?.message ?? null };
  };

  const updatePassword = async (newPassword: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  const value: AuthContextValue = {
    user,
    session,
    loading,
    isAnonymous,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPasswordForEmail,
    updatePassword,
    verifyOtp,
    resendSignUpOtp,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
