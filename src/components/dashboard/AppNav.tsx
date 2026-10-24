import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Library as LibraryIcon,
  Map as MapIcon,
  FileText,
  Layers,
  FlaskConical,
  Settings,
  LogIn,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { displayName } from "@/lib/display-name";
import { supabase } from "@/integrations/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import BrandMark from "@/components/brand/BrandMark";

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
}

interface AppNavProps {
  onNavigate?: () => void;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
}

const homeItem = { to: "/dashboard", label: "Home", icon: LayoutDashboard };
const roadmapItem = { to: "/roadmap", label: "Roadmap", icon: MapIcon };
const libraryItem = { to: "/library", label: "Library", icon: LibraryIcon };

// The three study tools are on the dashboard already, so the bar groups them
// under one "Tools" menu instead of spending three links on them.
const toolItems = [
  { to: "/sheets", label: "Sheets", icon: FileText, hint: "Structured study sheets" },
  { to: "/flashcards", label: "Flashcards", icon: Layers, hint: "Spaced-repetition decks" },
  { to: "/qbank", label: "QBank", icon: FlaskConical, hint: "USMLE-style questions" },
];

const NAV_LINK = "border-b px-3 pt-1.5 pb-[3px] text-sm font-medium transition-colors";

const NavLinkItem = ({ to, label, active, onClick }: { to: string; label: string; active: boolean; onClick: () => void }) => (
  <Link
    to={to}
    onClick={onClick}
    aria-current={active ? "page" : undefined}
    className={`${NAV_LINK} ${
      active ? "border-[color:var(--accent)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    }`}
  >
    {label}
  </Link>
);

const AppNav = ({ onNavigate, onOpenAuth, onOpenAccount }: AppNavProps) => {
  const { user, isAnonymous } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const name = displayName(user);
  const signedIn = !!user && !isAnonymous;
  // Signed in, the brand is the way home: it opens the dashboard, so a separate
  // Home link is noise. Guests keep Home, and the brand returns them to the
  // landing page.
  const leadItems = signedIn ? [roadmapItem] : [homeItem, roadmapItem];
  const brandTo = signedIn ? "/dashboard" : "/";

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

  const handleNav = () => {
    setMobileOpen(false);
    if (onNavigate) onNavigate();
  };

  // A prefix only counts at a path-segment boundary, so /qbank/session keeps
  // QBank lit but "/" doesn't match every route and light Home with it.
  const isActive = (to: string) =>
    location.pathname === to ||
    (to !== "/" && location.pathname.startsWith(`${to}/`));
  const toolsActive = toolItems.some((item) => isActive(item.to));

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
          className="flex items-center justify-between gap-3 h-full px-4 sm:gap-4 sm:px-6"
          style={{ maxWidth: "var(--max-w, 1280px)", margin: "0 auto" }}
        >
          {/* Brand */}
          <Link
            to={brandTo}
            onClick={handleNav}
            aria-label={signedIn ? "StudyBuddy AI — go to dashboard" : "StudyBuddy AI — home"}
            className="flex items-center gap-2.5 shrink-0 no-underline"
            style={{ color: "var(--fg)" }}
          >
            <BrandMark size={34} />
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
              className="hidden sm:inline"
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
          <nav className="hidden lg:flex items-center gap-1" aria-label="Main">
            {leadItems.map((item) => (
              <NavLinkItem key={item.to} to={item.to} label={item.label} active={isActive(item.to)} onClick={handleNav} />
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={`${NAV_LINK} inline-flex items-center gap-1 ${
                  toolsActive ? "border-[color:var(--accent)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Tools
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                {toolItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link
                        to={item.to}
                        onClick={handleNav}
                        aria-current={isActive(item.to) ? "page" : undefined}
                        className="flex cursor-pointer items-start gap-3 py-2"
                      >
                        <Icon className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                        <span>
                          <span className="block text-sm font-medium text-foreground">{item.label}</span>
                          <span className="block text-xs text-muted-foreground">{item.hint}</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <NavLinkItem to={libraryItem.to} label={libraryItem.label} active={isActive(libraryItem.to)} onClick={handleNav} />
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

            {isAnonymous || !user ? (
              <>
                <ThemeToggle />
                <button
                  type="button"
                  onClick={onOpenAccount}
                  aria-label="Settings"
                  title="Settings"
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                </button>
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
              </>
            ) : (
              // One account button: Go Pro, theme and sign out live in Settings.
              <button
                onClick={onOpenAccount}
                title="Settings"
                className="inline-flex h-9 items-center gap-2 rounded-full border border-border ps-1 pe-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground">
                  {name.charAt(0)}
                </span>
                <span className="max-w-[140px] truncate">{name}</span>
                <Settings style={{ width: 14, height: 14 }} className="text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Mobile actions */}
          <div className="flex lg:hidden items-center gap-2">
            {(isAnonymous || !user) && <ThemeToggle />}
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
              {[...leadItems, ...toolItems.map((t) => ({ ...t, nested: true })), libraryItem].map((item, idx, all) => {
                const active = isActive(item.to);
                const Icon = item.icon;
                const nested = "nested" in item;
                const firstTool = nested && !("nested" in all[idx - 1]);
                return (
                  <div key={item.to}>
                    {firstTool && (
                      <p className="pt-3 pb-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Tools
                      </p>
                    )}
                    <Link
                      to={item.to}
                      onClick={handleNav}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 border-b border-border py-3 text-[15px] font-medium ${
                        nested ? "ps-3" : ""
                      } ${active ? "text-[color:var(--accent)]" : "text-foreground"}`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 8, padding: "12px 0 4px" }}>
                {!isAnonymous && user ? (
                  <button
                    onClick={() => {
                      onOpenAccount();
                      setMobileOpen(false);
                    }}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground"
                  >
                    <Settings style={{ width: 14, height: 14 }} />
                    Settings · {name}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        onOpenAccount();
                        setMobileOpen(false);
                      }}
                      className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground"
                    >
                      <Settings style={{ width: 14, height: 14 }} />
                      Settings
                    </button>
                    <button
                      onClick={() => {
                        onOpenAuth();
                        setMobileOpen(false);
                      }}
                      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background"
                    >
                      <LogIn style={{ width: 14, height: 14 }} />
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

    </>
  );
};

export default AppNav;
