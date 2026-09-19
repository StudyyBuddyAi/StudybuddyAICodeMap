import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Loader2, LogOut, Moon, Sparkles, Sun } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import GoProModal from "@/components/GoProModal";

interface AccountDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
  username: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "You must be signed in",
  account_required: "Code redemption requires a registered account",
  invalid_code: "Invalid code",
  already_redeemed: "This code has already been used",
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

const AccountDashboard = ({ open, onOpenChange }: AccountDashboardProps) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const [code, setCode] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [goProOpen, setGoProOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("studybuddy-theme") === "dark");

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId && open,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_pro, pro_expires_at, username")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = profileQuery.data ?? null;
  useEffect(() => {
    if (profile?.username) setUsername(profile.username);
    else if (user?.email) setUsername(user.email.split("@")[0]);
  }, [profile?.username, user?.email]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("studybuddy-theme", isDark ? "dark" : "light");
  }, [isDark]);
  const isPro =
    profile?.is_pro === true &&
    (profile.pro_expires_at === null ||
      new Date(profile.pro_expires_at) > new Date());

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setRedeemError(null);
    setRedeemLoading(true);
    try {
      const { data, error } = await supabase.rpc("redeem_pro_code", {
        code_input: code,
      });
      if (error) {
        setRedeemError(error.message);
        return;
      }
      const result = data as {
        success: boolean;
        error?: string;
        expires_at?: string;
      } | null;
      if (!result || !result.success) {
        setRedeemError(
          ERROR_MESSAGES[result?.error ?? ""] ?? "Failed to redeem code"
        );
        return;
      }
      toast({
        title: result.expires_at
          ? `Pro activated until ${formatDate(result.expires_at)}`
          : "Pro activated",
      });
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    } finally {
      setRedeemLoading(false);
    }
  };

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = username.trim();
    if (!value || !userId) return;
    setUsernameSaving(true);
    const { error } = await supabase.from("profiles").update({ username: value }).eq("id", userId);
    setUsernameSaving(false);
    if (error) {
      toast({ title: "Could not save username", description: error.message, variant: "destructive" });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    toast({ title: "Username updated" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            Manage your account and subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-1">
            <p style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              marginBottom: 4,
            }}>
              Email
            </p>
            <p className="text-sm font-medium text-foreground truncate">
              {user?.email ?? "—"}
            </p>
          </div>

          <form onSubmit={saveUsername} className="space-y-2">
            <Label htmlFor="profile-username">Username</Label>
            <div className="flex gap-2">
              <Input id="profile-username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={40} />
              <Button type="submit" disabled={usernameSaving || !username.trim()}>{usernameSaving ? "Saving…" : "Save"}</Button>
            </div>
          </form>

          <div className="space-y-1">
            <p style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              marginBottom: 4,
            }}>
              Plan
            </p>
            {profileQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : isPro ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 10px",
                  borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--accent)",
                  background: "var(--accent-soft)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  color: "var(--accent)",
                }}>
                  Pro
                </span>
                {profile?.pro_expires_at && (
                  <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                    expires {formatDate(profile.pro_expires_at)}
                  </span>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 13, color: "var(--fg)" }}>Free plan</span>
            )}
          </div>

          <form onSubmit={handleRedeem} className="space-y-2 pt-2 border-t border-border/50">
            <Label
              htmlFor="redeem-code"
              style={{
                display: "block",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--fg-muted)",
                marginBottom: 4,
              }}
            >
              Redeem code
            </Label>
            <div className="flex gap-2">
              <Input
                id="redeem-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setRedeemError(null);
                }}
                placeholder="Enter code"
                disabled={redeemLoading}
                style={{
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              />
              <Button type="submit" disabled={redeemLoading || !code.trim()}>
                {redeemLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redeeming…
                  </>
                ) : (
                  "Redeem"
                )}
              </Button>
            </div>
            {redeemError && (
              <p className="text-sm text-destructive">{redeemError}</p>
            )}
          </form>

          <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
            {!isPro && <Button type="button" variant="outline" onClick={() => setGoProOpen(true)}><Sparkles className="mr-2 h-4 w-4" />Go Pro</Button>}
            <Button type="button" variant="outline" onClick={() => setIsDark((value) => !value)}>
              {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              {isDark ? "Light theme" : "Dark theme"}
            </Button>
            <Button type="button" variant="ghost" onClick={async () => { await signOut(); onOpenChange(false); navigate("/"); }}>
              <LogOut className="mr-2 h-4 w-4" />Sign out
            </Button>
          </div>
        </div>
      </DialogContent>
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </Dialog>
  );
};

export default AccountDashboard;
