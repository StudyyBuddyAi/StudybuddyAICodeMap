import { useEffect, useState } from "react";
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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
      if (!data.session) {
        supabase.auth.signInAnonymously();
      }
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

  // Re-establish an anonymous session immediately: the anon sign-in at mount only
  // runs inside the initial getSession() branch, so without this the app is left
  // with no JWT on an app route and every RLS-backed query fails until a reload.
  const signOut = async (): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      await supabase.auth.signInAnonymously();
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

  return {
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
}
