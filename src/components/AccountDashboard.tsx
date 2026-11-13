import { useState } from "react";
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
import { Loader2, LogIn, LogOut, Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsagePanel } from "@/components/usage/DailyUsage";
import { useTheme } from "@/hooks/use-theme";
import { cleanUsername, displayName, USERNAME_MAX } from "@/lib/display-name";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export type SettingsTab = "account" | "usage";

interface AccountDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  /** Opens the sign-in dialog; Settings shows a guest a way in. */
  onOpenAuth?: () => void;
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

const AccountDashboard = ({ open, onOpenChange, tab, onTabChange, onOpenAuth }: AccountDashboardProps) => {
  const { user, signOut, isAnonymous } = useAuth();
  const isGuest = !user || isAnonymous;
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {tab === "usage"
              ? "How much of today's usage limit you've used."
              : isGuest
              ? "Your preferences on this device."
              : "Your name and preferences."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => onTabChange(v as SettingsTab)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
          <TabsContent value="usage">
            <UsagePanel enabled={open && tab === "usage"} labelClassName={SECTION_LABEL} />
          </TabsContent>
          <TabsContent value="account">
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

          {/* Free access: no plan to choose, one usage limit a day for everyone. */}
          <div className="space-y-1">
            <p className={SECTION_LABEL}>Access</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">Free, with one daily usage limit</span>
              <Button type="button" size="sm" variant="outline" onClick={() => onTabChange("usage")}>
                See usage
              </Button>
            </div>
          </div>

          <ThemeSwitch isDark={isDark} onToggle={toggleTheme} />

          <Button type="button" variant="outline" onClick={handleSignOut} className="w-full gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
        )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AccountDashboard;
