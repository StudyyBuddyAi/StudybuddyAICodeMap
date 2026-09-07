import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { applyAnonUsage, readPendingUpgrade, runPostUpgradeMigrations } from "@/lib/auth-upgrade";

type Status = "working" | "failed";

const CALLBACK_TIMEOUT_MS = 8000;

/**
 * Lands here after the Google OAuth redirect. Deliberately does not call
 * useAuth(): that hook's mount effect calls signInAnonymously() whenever
 * getSession() comes back empty, which here would race the incoming real
 * session. Talk to supabase.auth directly instead, the way ResetPassword does.
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("working");

  useEffect(() => {
    let settled = false;

    const finish = async (userId: string) => {
      if (settled) return;
      settled = true;

      const pending = readPendingUpgrade();
      const today = new Date().toISOString().split("T")[0];
      if (pending && pending.usageDate === today) {
        try {
          await applyAnonUsage(userId, pending.anonUserId, pending.records, pending.usageDate);
        } catch {
          // Non-fatal: the sign-in itself already succeeded.
        }
      }

      await runPostUpgradeMigrations(userId);

      toast({ title: "Signed in" });
      navigate(pending?.returnTo ?? "/dashboard", { replace: true });
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      setStatus("failed");
    };

    // supabase-js's own initialization may strip an "#error=..." fragment
    // before this component mounts, so this check is a best effort — the
    // timeout below is what reliably catches a cancelled or failed flow.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    if (hashParams.get("error") || queryParams.get("error")) {
      fail();
      return;
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "SIGNED_IN" && newSession?.user && !newSession.user.is_anonymous) {
        finish(newSession.user.id);
      }
    });

    // Fallback in case detectSessionInUrl already resolved before this
    // component subscribed to onAuthStateChange.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user && !data.session.user.is_anonymous) {
        finish(data.session.user.id);
      }
    });

    const timeout = window.setTimeout(fail, CALLBACK_TIMEOUT_MS);

    return () => {
      subscription.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate, toast]);

  if (status === "working") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <PageLoader context="session" fullPage={false} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4">
      <div className="max-w-sm mx-auto mt-24 p-6 rounded-xl bg-card border border-border shadow-sm space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Sign-in didn't complete</h1>
        <p className="text-sm text-muted-foreground">
          The Google sign-in was cancelled or didn't finish. You can try again from the sign in menu.
        </p>
        <Button className="w-full h-10 rounded-lg font-medium" onClick={() => navigate("/dashboard")}>
          Back to home
        </Button>
      </div>
    </div>
  );
};

export default AuthCallback;
