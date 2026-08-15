import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Library as LibraryIcon,
  Map as MapIcon,
  FileText,
  Layers,
  FlaskConical,
  Settings,
  LogOut,
  LogIn,
  Sparkles,
  Stethoscope,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import GoProModal from "@/components/GoProModal";

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
}

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

interface DashboardSidebarProps {
  onNavigate?: () => void;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const DashboardSidebar = ({
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  collapsed = false,
  onToggleCollapse,
}: DashboardSidebarProps) => {
  const { user, isAnonymous, signOut } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [goProOpen, setGoProOpen] = useState(false);

  const userId = user?.id ?? null;
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId && !isAnonymous,
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

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/roadmap", label: "Roadmap", icon: MapIcon },
    { to: "/sheets", label: "Study Sheet", icon: FileText },
    { to: "/flashcards", label: "Flashcards", icon: Layers },
    { to: "/qbank", label: "QBank", icon: FlaskConical },
    { to: "/library", label: "Library", icon: LibraryIcon },
  ];

  const handleNavClick = () => {
    if (onNavigate) onNavigate();
  };

  const handleSettingsClick = () => {
    onOpenAccount();
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({ title: "Sign out failed", description: error, variant: "destructive" });
    } else {
      toast({ title: "Signed out" });
      navigate("/dashboard");
    }
  };

  const handleSignIn = () => {
    onOpenAuth();
  };

  return (
    <>
      <aside className={`flex h-full w-full flex-col gap-4 py-4 transition-all duration-300 ${collapsed ? "px-2 items-center" : "px-3"}`}>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex self-end items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Brand */}
        <Link
          to="/dashboard"
          onClick={handleNavClick}
          className={`flex items-center gap-2.5 rounded-md transition-colors ${collapsed ? "px-0 py-1 justify-center" : "px-2 py-1"}`}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary shrink-0">
            <Stethoscope className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-foreground">
                StudyBuddy
              </p>
              <p className="text-[11px] text-muted-foreground">
                High-yield exam prep
              </p>
            </div>
          )}
        </Link>

        {/* Workspace block */}
        {!collapsed && (
          isAnonymous || !user ? (
            <div className="rounded-lg text bg-card border border-border p-3 space-y-2">
              <p className="text-[13px] font-medium text-foreground leading-snug">
                Sign in to save your progress
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Sync decks and study history across devices.
              </p>
              <Button
                size="sm"
                onClick={handleSignIn}
                className="w-full h-8 rounded-md text-xs font-medium"
              >
                <LogIn className="h-3.5 w-3.5 mr-1.5" />
                Sign In
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-3 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Workspace
              </p>
              <p className="text-[13px] font-medium text-foreground truncate">
                {user.email ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isPro
                  ? `Pro${
                      profile?.pro_expires_at
                        ? ` — expires ${formatDate(profile.pro_expires_at)}`
                        : ""
                    }`
                  : "Free plan"}
              </p>
            </div>
          )
        )}

        {/* Main nav */}
        <nav className="flex flex-col gap-0.5 w-full">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={handleNavClick}
                title={collapsed ? item.label : undefined}
                className={`flex items-center rounded-md text-[13px] font-medium transition-colors ${
                  collapsed ? "justify-center px-0 w-9 h-9 mx-auto" : "gap-2.5 px-2.5 h-8"
                } ${
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`} />
                {!collapsed && item.label}
              </Link>
            );
          })}
          {!collapsed && !isAnonymous && user && (
            <button
              onClick={handleSettingsClick}
              className="flex items-center gap-2.5 rounded-md px-2.5 h-8 text-[13px] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors text-left"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          )}
          {collapsed && !isAnonymous && user && (
            <button
              onClick={handleSettingsClick}
              title="Settings"
              className="flex items-center justify-center w-9 h-9 mx-auto rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </nav>

        <div className="flex-1" />

        {/* Bottom actions */}
        {!isPro && !isAnonymous && user && !collapsed && (
          <Button
            variant="outline"
            className="w-full h-9 rounded-lg text-[13px] font-medium"
            onClick={() => setGoProOpen(true)}
          >
            <Sparkles className="h-4 w-4 mr-2 text-primary" />
            Go Pro
          </Button>
        )}
        {!isPro && !isAnonymous && user && collapsed && (
          <button
            onClick={() => setGoProOpen(true)}
            title="Go Pro"
            className="flex items-center justify-center w-9 h-9 mx-auto rounded-md text-primary hover:bg-accent transition-colors"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        )}
        <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />

        {!collapsed && (
          <p className="text-[10px] text-muted-foreground leading-snug text-center px-1 pb-1">
            For educational use only · Not for clinical practice
          </p>
        )}

        <div className={`flex items-center gap-2 pt-3 border-t border-border ${collapsed ? "flex-col justify-center w-full" : "justify-between"}`}>
          <ThemeToggle />
          {!isAnonymous && user && !collapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Sign out
            </Button>
          )}
          {!isAnonymous && user && collapsed && (
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

export default DashboardSidebar;
