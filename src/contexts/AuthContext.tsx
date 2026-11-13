import { friendlyAuthError } from "@/lib/auth-errors";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isDisposableEmail } from "@/lib/email-domains";
import { siteUrl } from "@/lib/site-url";
import { isRecoveryPending, markRecoveryPending } from "@/lib/recovery-landing";
import {
  applyAnonUsage,
  runPostUpgradeMigrations,
  snapshotAnonUsage,
  stashPendingUpgrade,
  clearPendingUpgrade,
} from "@/lib/auth-upgrade";

/*
 * Using StudyBuddy takes an account. Visitors are no longer signed in as
 * anonymous guests: the landing page and the memorial are open to anyone, and
 * every app page asks for an account first (src/components/auth/RequireAccount).
 *
 * Guests from before that change can still hold an anonymous session in their
 * browser. They meet the same sign-in screen, and signing up turns their guest
 * user into a real account in place (same id), so everything they made stays
 * theirs; `isAnonymous` and the upgrade paths below exist for them.
 */

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAnonymous: boolean;
  signUp: (
    email: string,
    password: string,
    username?: string | null,
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
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

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

      // A reset link opened: wherever Supabase landed the reader (the Site URL
      // when /reset-password isn't allow-listed), the new password is set there.
      if (event === "PASSWORD_RECOVERY") {
        markRecoveryPending();
        if (window.location.pathname !== "/reset-password") {
          navigateRef.current("/reset-password", { replace: true });
        }
      }

      // If user confirms email via magic link, event will be USER_UPDATED
      // The session will be refreshed automatically by Supabase
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // The reset link was captured before the client consumed it, but the event
  // may have fired before this provider subscribed: route on the flag alone.
  useEffect(() => {
    if (!loading && session && !session.user.is_anonymous && isRecoveryPending() && pathname !== "/reset-password") {
      navigate("/reset-password", { replace: true });
    }
  }, [loading, session, pathname, navigate]);

  const isAnonymous = Boolean(session?.user?.is_anonymous);

  const signUp = async (
    email: string,
    password: string,
    username?: string | null
  ): Promise<{ error: string | null; needsVerification: boolean; email?: string }> => {
    if (isDisposableEmail(email)) {
      return { error: "Please use a permanent email address.", needsVerification: false };
    }

    // Signup is two-phase because GoTrue refuses to set a password on an anonymous
    // user: updateUser({ email }) writes to `email_change` (not `email`) and leaves
    // is_anonymous true until the OTP is confirmed. The password is applied in
    // verifyOtp, once the user is no longer anonymous.
    if (isAnonymous) {
      const { error } = await supabase.auth.updateUser({ email, data: username ? { username } : undefined });
      if (error) return { error: friendlyAuthError(error.message), needsVerification: false };
      return { error: null, needsVerification: true, email };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: username ? { data: { username } } : undefined,
    });
    // Never say whether the email already has an account.
    if (error) return { error: friendlyAuthError(error.message), needsVerification: false };
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
    if (error) return { error: friendlyAuthError(error.message) };

    // The anonymous-upgrade path above could not set the password before
    // verification, so apply it now that the user is no longer anonymous.
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) return { error: friendlyAuthError(passwordError.message) };

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
    // A guest upgrading their anonymous session got the first code from
    // updateUser({ email }), so the next one is requested the same way.
    // Resent codes were reported as never arriving on this path.
    const { error } =
      type === "email_change"
        ? await supabase.auth.updateUser({ email })
        : await supabase.auth.resend({ type, email });
    return { error: error ? friendlyAuthError(error.message) : null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const anonUserId = session?.user?.is_anonymous ? session.user.id : null;
    const today = new Date().toISOString().split("T")[0];

    const anonUsage = anonUserId ? await snapshotAnonUsage(anonUserId, today) : [];

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: friendlyAuthError(error.message) };

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

  // Signed out, an app page shows its sign-in screen again (RequireAccount):
  // no guest session is started in its place.
  const signOut = async (): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signOut();
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
