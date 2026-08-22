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
  Menu,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import GoProModal from "@/components/GoProModal";

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
}

interface AppNavProps {
  onNavigate?: () => void;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
}

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/roadmap", label: "Roadmap", icon: MapIcon },
  { to: "/sheets", label: "Sheets", icon: FileText },
  { to: "/flashcards", label: "Flashcards", icon: Layers },
  { to: "/qbank", label: "QBank", icon: FlaskConical },
  { to: "/library", label: "Library", icon: LibraryIcon },
];

const AppNav = ({ onNavigate, onOpenAuth, onOpenAccount }: AppNavProps) => {
  const { user, isAnonymous, signOut } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [goProOpen, setGoProOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({ title: "Sign out failed", description: error, variant: "destructive" });
    } else {
      toast({ title: "Signed out" });
      navigate("/dashboard");
    }
    setMobileOpen(false);
  };

  const handleNav = () => {
    setMobileOpen(false);
    if (onNavigate) onNavigate();
  };

  const isActive = (to: string) =>
    location.pathname === to || (to !== "/dashboard" && location.pathname.startsWith(to));

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          background: "color-mix(in srgb, var(--bg) 82%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderColor: "var(--border)",
          height: "var(--nav-h, 64px)",
        }}
      >
        <div
          className="flex items-center justify-between gap-4 h-full px-6"
          style={{ maxWidth: "var(--max-w, 1280px)", margin: "0 auto" }}
        >
          {/* Brand */}
          <Link
            to="/dashboard"
            onClick={handleNav}
            className="flex items-center gap-2.5 shrink-0 no-underline"
            style={{ color: "var(--fg)" }}
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 22,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: "var(--fg)",
              }}
            >
              StudyBuddy
              <span style={{ fontStyle: "italic", color: "var(--accent)" }}> AI</span>
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--fg-muted)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                padding: "2px 6px",
                border: "1px solid var(--border-strong)",
                borderRadius: 4,
              }}
            >
              Beta
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={handleNav}
                  aria-current={active ? "page" : undefined}
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 14,
                    fontWeight: 500,
                    color: active ? "var(--fg)" : "var(--fg-muted)",
                    textDecoration: "none",
                    padding: "6px 12px 3px",
                    borderBottom: active
                      ? "1px solid var(--accent)"
                      : "1px solid transparent",
                    transition:
                      "color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = "var(--fg)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = "var(--fg-muted)";
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop right actions */}
          <div className="hidden lg:flex items-center gap-2 shrink-0">
            {isPro && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius-pill)",
                  color: "var(--accent)",
                }}
              >
                Pro
              </span>
            )}

            {!isPro && !isAnonymous && user && (
              <button
                onClick={() => setGoProOpen(true)}
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  fontWeight: 500,
                  padding: "9px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-strong)",
                  background: "transparent",
                  color: "var(--fg)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition:
                    "background var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-panel)";
                  e.currentTarget.style.borderColor = "var(--fg)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                }}
              >
                <Sparkles style={{ width: 14, height: 14 }} />
                Go Pro
              </button>
            )}

            {!isAnonymous && user && (
              <button
                onClick={onOpenAccount}
                title="Settings"
                aria-label="Settings"
                style={{
                  width: 36,
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-pill)",
                  cursor: "pointer",
                  color: "var(--fg)",
                  transition:
                    "background var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-panel)";
                  e.currentTarget.style.borderColor = "var(--fg)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                }}
              >
                <Settings style={{ width: 16, height: 16 }} />
              </button>
            )}

            {isAnonymous || !user ? (
              <button
                onClick={onOpenAuth}
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  fontWeight: 500,
                  padding: "9px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid transparent",
                  background: "var(--fg)",
                  color: "var(--bg)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <LogIn style={{ width: 14, height: 14 }} />
                Sign in
              </button>
            ) : (
              <button
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
                style={{
                  width: 36,
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-pill)",
                  cursor: "pointer",
                  color: "var(--fg-muted)",
                  transition: "color var(--dur-micro) var(--ease-out)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-muted)")}
              >
                <LogOut style={{ width: 16, height: 16 }} />
              </button>
            )}

            <ThemeToggle />
          </div>

          {/* Mobile actions */}
          <div className="flex lg:hidden items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              style={{
                width: 36,
                height: 36,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                color: "var(--fg)",
              }}
            >
              {mobileOpen ? (
                <X style={{ width: 16, height: 16 }} />
              ) : (
                <Menu style={{ width: 16, height: 16 }} />
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div
            className="lg:hidden absolute left-0 right-0 top-full"
            style={{
              background: "var(--bg)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "var(--shadow-2)",
              zIndex: 49,
            }}
          >
            <nav style={{ padding: "6px 16px 10px" }}>
              {navItems.map((item) => {
                const active = isActive(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={handleNav}
                    aria-current={active ? "page" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "13px 0",
                      borderBottom: "1px solid var(--border)",
                      fontFamily: "var(--font-sans)",
                      fontSize: 15,
                      fontWeight: 500,
                      color: active ? "var(--accent)" : "var(--fg)",
                      textDecoration: "none",
                    }}
                  >
                    <Icon style={{ width: 16, height: 16 }} />
                    {item.label}
                  </Link>
                );
              })}

              <div style={{ display: "flex", gap: 8, padding: "12px 0 4px" }}>
                {!isPro && !isAnonymous && user && (
                  <button
                    onClick={() => {
                      setGoProOpen(true);
                      setMobileOpen(false);
                    }}
                    style={{
                      flex: 1,
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      padding: "10px 0",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-strong)",
                      background: "transparent",
                      color: "var(--fg)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Sparkles style={{ width: 14, height: 14 }} />
                    Go Pro
                  </button>
                )}

                {!isAnonymous && user && (
                  <button
                    onClick={() => {
                      onOpenAccount();
                      setMobileOpen(false);
                    }}
                    style={{
                      flex: 1,
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      padding: "10px 0",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-strong)",
                      background: "transparent",
                      color: "var(--fg)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Settings style={{ width: 14, height: 14 }} />
                    Settings
                  </button>
                )}

                {!isAnonymous && user ? (
                  <button
                    onClick={handleSignOut}
                    style={{
                      flex: 1,
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      padding: "10px 0",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-strong)",
                      background: "transparent",
                      color: "var(--fg-muted)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <LogOut style={{ width: 14, height: 14 }} />
                    Sign out
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onOpenAuth();
                      setMobileOpen(false);
                    }}
                    style={{
                      flex: 1,
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      padding: "10px 0",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid transparent",
                      background: "var(--fg)",
                      color: "var(--bg)",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <LogIn style={{ width: 14, height: 14 }} />
                    Sign in
                  </button>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </>
  );
};

export default AppNav;
