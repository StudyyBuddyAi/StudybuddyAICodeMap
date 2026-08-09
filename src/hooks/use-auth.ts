import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { isDisposableEmail } from "@/lib/email-domains";

const STORAGE_KEY = "studybuddy_decks_v1";
const HISTORY_STORAGE_KEY = "studybuddy_history";

type LocalHistoryItem = {
  id: string;
  topic: string;
  input: string;
  output: string;
  timestamp: number;
  modeInfo?: {
    examMode: string;
    difficulty: string;
    focus: string;
    length: string;
  };
};

type LocalCard = {
  id: string;
  question: string;
  answer: string;
  tag: string;
  topic: string;
  topicEmoji?: string;
  createdAt: number;
  interval: number;
  dueAt: number;
  lastReviewed: number | null;
  reviewCount: number;
};

async function migrateLocalCardsToServer(userId: string): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let cards: LocalCard[];
  try {
    const parsed = JSON.parse(raw);
    cards = Array.isArray(parsed) ? parsed : [];
  } catch {
    return;
  }
  if (!cards.length) return;

  // Group by topic
  const topicMap = new Map<string, { topic: string; emoji?: string }>();
  for (const c of cards) {
    if (!topicMap.has(c.topic)) {
      topicMap.set(c.topic, { topic: c.topic, emoji: c.topicEmoji });
    }
  }

  const deckRows = Array.from(topicMap.values()).map((t) => ({
    user_id: userId,
    topic: t.topic,
    topic_emoji: t.emoji ?? null,
  }));

  const { error: deckError } = await supabase
    .from("decks")
    .upsert(deckRows, { onConflict: "user_id,topic" });
  if (deckError) throw deckError;

  const { data: decks, error: fetchError } = await supabase
    .from("decks")
    .select("id, topic")
    .eq("user_id", userId)
    .in("topic", Array.from(topicMap.keys()));
  if (fetchError) throw fetchError;

  const deckIdByTopic = new Map<string, string>();
  for (const d of decks ?? []) deckIdByTopic.set(d.topic, d.id);

  const cardRows = cards
    .map((c) => {
      const deckId = deckIdByTopic.get(c.topic);
      if (!deckId) return null;
      return {
        user_id: userId,
        deck_id: deckId,
        client_id: c.id,
        question: c.question,
        answer: c.answer,
        tag: c.tag,
        topic: c.topic,
        topic_emoji: c.topicEmoji ?? null,
        interval_days: c.interval ?? 0,
        due_at: new Date(c.dueAt ?? Date.now()).toISOString(),
        last_reviewed_at: c.lastReviewed
          ? new Date(c.lastReviewed).toISOString()
          : null,
        review_count: c.reviewCount ?? 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const { error: cardError } = await supabase
    .from("cards")
    .upsert(cardRows, {
      onConflict: "user_id,client_id",
      ignoreDuplicates: true,
    });
  if (cardError) throw cardError;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function migrateLocalStudyHistoryToServer(userId: string): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HISTORY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let items: LocalHistoryItem[];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    return;
  }
  if (!items.length) return;

  const rows = items.map((item) => ({
    user_id: userId,
    topic: item.topic,
    input: item.input,
    output: item.output,
    exam_mode: item.modeInfo?.examMode ?? null,
    difficulty: item.modeInfo?.difficulty ?? null,
    focus: item.modeInfo?.focus ?? null,
    length: item.modeInfo?.length ?? null,
    created_at: new Date(item.timestamp ?? Date.now()).toISOString(),
  }));

  const { error } = await supabase.from("study_history").insert(rows);
  if (error) throw error;

  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

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

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const isAnonymous = Boolean(session?.user?.is_anonymous);

  // Signup is two-phase because GoTrue refuses to set a password on an anonymous
  // user: updateUser({ email }) writes to `email_change` (not `email`) and leaves
  // is_anonymous true until the OTP is confirmed. So we send the code here and
  // apply the password in confirmSignUp once the user is no longer anonymous.
  const startSignUp = async (
    email: string,
    password: string
  ): Promise<{ error: string | null; otpType: "email_change" | "signup" | null }> => {
    if (isDisposableEmail(email)) {
      return { error: "Please use a permanent email address.", otpType: null };
    }

    if (isAnonymous) {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) return { error: error.message, otpType: null };
      return { error: null, otpType: "email_change" };
    }

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message, otpType: null };
    return { error: null, otpType: "signup" };
  };

  const confirmSignUp = async (
    email: string,
    token: string,
    password: string,
    otpType: "email_change" | "signup"
  ): Promise<{ error: string | null }> => {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: otpType,
    });
    if (verifyError) return { error: verifyError.message };

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) return { error: passwordError.message };

    const { data: { user: confirmedUser } } = await supabase.auth.getUser();
    const uid = confirmedUser?.id;

    if (uid) {
      try {
        await migrateLocalCardsToServer(uid);
      } catch {
        toast({
          title: "Couldn't sync local cards to your account, please try again later",
          variant: "destructive",
        });
      }
      try {
        await migrateLocalStudyHistoryToServer(uid);
      } catch {
        toast({
          title: "Couldn't sync local study history to your account, please try again later",
          variant: "destructive",
        });
      }
    }

    return { error: null };
  };

  const resendSignUpOtp = async (
    email: string,
    otpType: "email_change" | "signup"
  ): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.resend({ type: otpType, email });
    return { error: error?.message ?? null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const anonUserId = session?.user?.is_anonymous ? session.user.id : null;
    const today = new Date().toISOString().split("T")[0];

    let anonUsage: { kind: string; count: number }[] = [];
    if (anonUserId) {
      const { data } = await supabase
        .from("usage_records")
        .select("kind, count")
        .eq("user_id", anonUserId)
        .eq("usage_date", today);
      anonUsage = data ?? [];
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    if (anonUsage.length > 0) {
      const { data: { user: realUser } } = await supabase.auth.getUser();
      const realUserId = realUser?.id;
      if (realUserId && realUserId !== anonUserId) {
        for (const record of anonUsage) {
          const { data: existing } = await supabase
            .from("usage_records")
            .select("count")
            .eq("user_id", realUserId)
            .eq("kind", record.kind)
            .eq("usage_date", today)
            .maybeSingle();

          const existingCount = existing?.count ?? 0;
          const mergedCount = Math.max(existingCount, record.count);

          await supabase
            .from("usage_records")
            .upsert(
              { user_id: realUserId, kind: record.kind, usage_date: today, count: mergedCount },
              { onConflict: "user_id,kind,usage_date" }
            );
        }
      }
    }

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
      redirectTo: `${import.meta.env.VITE_SITE_URL}/reset-password`,
    });
    return { error: error?.message ?? null };
  };

  const updatePassword = async (newPassword: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  return {
    user, session, loading, isAnonymous,
    startSignUp, confirmSignUp, resendSignUpOtp,
    signIn, signOut, resetPasswordForEmail, updatePassword,
  };
}
