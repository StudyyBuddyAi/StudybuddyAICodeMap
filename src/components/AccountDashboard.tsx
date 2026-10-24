import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Loader2, LogIn, LogOut, Moon, Sparkles, Sun } from "lucide-react";
import RedeemCodeForm from "@/components/RedeemCodeForm";
import { formatPlanDate } from "@/lib/format-plan-date";
import { Switch } from "@/components/ui/switch";
import GoProModal from "@/components/GoProModal";
import { useTheme } from "@/hooks/use-theme";
import { cleanUsername, displayName, USERNAME_MAX } from "@/lib/display-name";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface AccountDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the sign-in dialog; Settings shows a guest a way in. */
  onOpenAuth?: () => void;
}

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
}

const SECTION_LABEL = "block font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground";

const ThemeSwitch = ({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) => (
  <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-4">
    <Label htmlFor="settings-theme" className="flex items-center gap-2 text-sm font-medium">
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} Dark theme
    </Label>
    <Switch id="settings-theme" checked={isDark} onCheckedChange={onToggle} />
  </div>
);

const AccountDashboard = ({ open, onOpenChange, onOpenAuth }: AccountDashboardProps) => {
  const { user, signOut, isAnonymous } = useAuth();
  const isGuest = !user || isAnonymous;
  const [showRedeem, setShowRedeem] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const userId = user?.id ?? null;

  const [goProOpen, setGoProOpen] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const currentName = displayName(user);
  const nameDraft = username ?? currentName;

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanUsername(nameDraft);
    if (!clean) {
      setNameError("Use at least 2 characters.");
      return;
    }
    setNameSaving(true);
    setNameError(null);
    const { error } = await supabase.auth.updateUser({ data: { username: clean } });
    setNameSaving(false);
    if (error) {
      setNameError("Couldn't save your username. Please try again.");
      return;
    }
    setUsername(null);
    toast({ title: "Username saved" });
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({ title: "Sign out failed", description: "Please try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Signed out" });
    onOpenChange(false);
    navigate("/dashboard");
  };

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId && !isGuest && open,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_pro, pro_expires_at")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = profileQuery.data ?? null;
  const isPro =
    profile?.is_pro === true &&
    (profile.pro_expires_at === null ||
      new Date(profile.pro_expires_at) > new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {isGuest ? "Your preferences on this device." : "Your name, plan and preferences."}
          </DialogDescription>
        </DialogHeader>

        {isGuest ? (
          <div className="space-y-5 pt-2">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm text-foreground">
                You're studying as a guest. Sign in to save your progress, choose a username and use the QBank.
              </p>
              <Button
                type="button"
                className="w-full gap-2"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAuth?.();
                }}
              >
                <LogIn className="h-4 w-4" /> Sign in or create an account
              </Button>
            </div>
            <ThemeSwitch isDark={isDark} onToggle={toggleTheme} />
          </div>
        ) : (
        <div className="space-y-5 pt-2">
          <form onSubmit={saveUsername} className="space-y-2">
            <Label htmlFor="settings-username" className={SECTION_LABEL}>
              Username
            </Label>
            <div className="flex gap-2">
              <Input
                id="settings-username"
                value={nameDraft}
                maxLength={USERNAME_MAX}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setNameError(null);
                }}
                disabled={nameSaving}
              />
              <Button type="submit" variant="outline" disabled={nameSaving || nameDraft.trim() === currentName}>
                {nameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {nameError ? (
              <p className="text-sm text-destructive">{nameError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Shown in the app. Only you can see it.</p>
            )}
          </form>

          <div className="space-y-1">
            <p className={SECTION_LABEL}>
              Email
            </p>
            <p className="text-sm font-medium text-foreground truncate">
              {user?.email ?? "—"}
            </p>
          </div>

          <div className="space-y-1">
            <p className={SECTION_LABEL}>
              Plan
            </p>
            {profileQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : isPro ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="inline-flex items-center rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Pro
                </span>
                {profile?.pro_expires_at && (
                  <span className="text-sm text-muted-foreground">
                    expires {formatPlanDate(profile.pro_expires_at)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">Free plan</span>
                <Button type="button" size="sm" onClick={() => setGoProOpen(true)} className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Go Pro
                </Button>
              </div>
            )}
          </div>

          {/* A code is for getting Pro: a Pro member only needs it to renew. */}
          {!profileQuery.isLoading && (!isPro || showRedeem) ? (
            <div className="space-y-2 border-t border-border/50 pt-4">
              <p className={SECTION_LABEL}>Pro access code</p>
              <p className="text-xs text-muted-foreground">
                {isPro
                  ? "Have a new code? Enter it to extend your Pro access."
                  : "Have a Pro access code from StudyBuddy? Enter it to unlock Pro on this account."}
              </p>
              <RedeemCodeForm autoFocus={showRedeem} onRedeemed={() => setShowRedeem(false)} />
            </div>
          ) : isPro ? (
            <button
              type="button"
              onClick={() => setShowRedeem(true)}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Activate another code
            </button>
          ) : null}

          <ThemeSwitch isDark={isDark} onToggle={toggleTheme} />

          <Button type="button" variant="outline" onClick={handleSignOut} className="w-full gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
        )}
        <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
      </DialogContent>
    </Dialog>
  );
};

export default AccountDashboard;
