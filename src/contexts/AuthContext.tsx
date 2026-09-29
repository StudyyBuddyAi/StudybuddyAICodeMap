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
 * Explicit-logout marker (Strategy 1). Set when the user intentionally signs
 * out so the bootstrap does not immediately mint a replacement anonymous user
 * (which reads as "my account/subscription disappeared"). Cleared only when a
 * real (non-anonymous) session arrives. Kept in localStorage so it survives a
 * refresh and is visible to every tab sharing the browser.
 */
const EXPLICIT_LOGOUT_KEY = "sb_explicit_logout";
const markExplicitLogout = () => {
  try {
    localStorage.setItem(EXPLICIT_LOGOUT_KEY, "1");
  } catch {
    // Storage can be unavailable (private browsing); the marker is best-effort.
  }
};
const hasExplicitLogout = () => {
  try {
    return localStorage.getItem(EXPLICIT_LOGOUT_KEY) === "1";
  } catch {
    return false;
  }
};
const clearExplicitLogout = () => {
  try {
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  } catch {
    // ignore
  }
};

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

      // A real (non-anonymous) session means the user just signed in: an
      // earlier explicit logout no longer applies, so drop the marker.
      // Never cleared for anonymous sessions.
      if (newSession?.user && !newSession.user.is_anonymous) {
        clearExplicitLogout();
      }

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
  // (sign-out — unless an explicit logout marker is set), and so leaving an
  // auth landing route re-arms it.
  useEffect(() => {
    if (loading || session || onAuthLanding) return;
    // An explicit, still-standing logout must not be undone by the bootstrap
    // creating a fresh anonymous session on this or any later tab/refresh.
    if (hasExplicitLogout()) return;
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

  // Explicit logout (Strategy 1): mark the intent BEFORE signing out so the
  // bootstrap leaves the user signed out instead of minting a replacement
  // anonymous account ("looks like a brand-new user"). Anonymous sessions never
  // set the marker — only a real account sign-out does. If a failed sign-out
  // leaves the local session intact, the user is not actually logged out, so
  // the marker is dropped again.
  const signOut = async (): Promise<{ error: string | null }> => {
    if (session?.user && !session.user.is_anonymous) {
      markExplicitLogout();
    }
    const { error } = await supabase.auth.signOut();
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      clearExplicitLogout();
    }
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
