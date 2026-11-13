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
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { displayName } from "@/lib/display-name";
import ThemeToggle from "@/components/ThemeToggle";
import BrandMark from "@/components/brand/BrandMark";
import { MemorialRibbonLink } from "@/components/memorial/entries";

interface AppNavProps {
  onNavigate?: () => void;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
}

/**
 * Every page, one button each, always in view. The study tools used to sit
 * under a "Tools" menu and the whole bar folded into a hamburger on a phone,
 * so reaching QBank from Flashcards took two taps and a guess; now it is one
 * tap from anywhere, on any screen.
 */
export const NAV_ITEMS = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/roadmap", label: "Roadmap", icon: MapIcon },
  { to: "/sheets", label: "Sheets", icon: FileText },
  { to: "/flashcards", label: "Flashcards", icon: Layers },
  { to: "/qbank", label: "QBank", icon: FlaskConical },
  { to: "/library", label: "Library", icon: LibraryIcon },
] as const;

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]";
/** The page you are on is inked in; the rest stay quiet until hovered. */
const ON = "bg-foreground text-background shadow-[0_1px_2px_rgba(15,23,42,0.18)]";
const OFF = "text-muted-foreground hover:bg-secondary hover:text-foreground";

const AppNav = ({ onNavigate, onOpenAuth, onOpenAccount }: AppNavProps) => {
  const { user, isAnonymous } = useAuth();
  const location = useLocation();
  const name = displayName(user);
  const signedIn = !!user && !isAnonymous;
  const brandTo = signedIn ? "/dashboard" : "/";

  // A prefix only counts at a path-segment boundary, so /qbank/session keeps
  // QBank lit but "/" doesn't match every route.
  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <header
      data-app-nav
      className="sticky top-0 z-50 border-b"
      style={{
        background: "color-mix(in srgb, var(--bg) 84%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderColor: "var(--border)",
      }}
    >
      <div className="mx-auto px-4 sm:px-6" style={{ maxWidth: "var(--max-w, 1280px)" }}>
        {/* 63px + the 1px border: the 64px --nav-h that sticky bars sit under.
            Below lg the second row makes it taller (openmed-tokens.css). */}
        <div className="flex h-14 items-center justify-between gap-3 lg:h-[63px] lg:gap-4">
          {/* Brand, and the memorial's ribbon beside it when that entry point is on. */}
          <div className="flex shrink-0 items-center gap-1.5">
          <Link
            to={brandTo}
            onClick={onNavigate}
            aria-label={signedIn ? "StudyBuddy AI — go to dashboard" : "StudyBuddy AI — home"}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg no-underline ${FOCUS}`}
            style={{ color: "var(--fg)" }}
          >
            <BrandMark size={32} />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 21,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: "var(--fg)",
              }}
            >
              StudyBuddy
              <span style={{ fontStyle: "italic", color: "var(--accent)" }}> AI</span>
            </span>
            <span
              className="hidden xl:inline"
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
          <MemorialRibbonLink />
          </div>

          {/* Pages — one row in the bar from lg up. */}
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-0.5 rounded-full border border-border bg-[color:color-mix(in_srgb,var(--bg-elevated)_70%,transparent)] p-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
                const active = isActive(to);
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150 ${FOCUS} ${
                        active ? ON : OFF
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Account */}
          <div className="flex shrink-0 items-center gap-2">
            {signedIn ? (
              // One account button: usage, theme and sign out live in Settings.
              <button
                type="button"
                onClick={onOpenAccount}
                title="Settings"
                aria-label={`Settings · ${name}`}
                className={`inline-flex h-9 items-center gap-2 rounded-full border border-border p-1 text-sm font-medium text-foreground transition-colors hover:bg-secondary xl:pe-3 ${FOCUS}`}
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground">
                  {name.charAt(0)}
                </span>
                <span className="hidden max-w-[140px] truncate xl:inline">{name}</span>
                <Settings className="hidden h-3.5 w-3.5 text-muted-foreground xl:block" aria-hidden />
              </button>
            ) : (
              <>
                <ThemeToggle />
                <button
                  type="button"
                  onClick={onOpenAccount}
                  aria-label="Settings"
                  title="Settings"
                  className={`hidden h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:grid ${FOCUS}`}
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 ${FOCUS}`}
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden />
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

        {/* Pages below lg: a second row of the same buttons, all six in reach
            at once — no menu to open. */}
        <nav aria-label="Main" className="pb-2 lg:hidden">
          <ul className="grid grid-cols-6 gap-0.5 rounded-2xl border border-border bg-[color:color-mix(in_srgb,var(--bg-elevated)_70%,transparent)] p-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
              const active = isActive(to);
              return (
                <li key={to} className="min-w-0">
                  <Link
                    to={to}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-10 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-[10.5px] font-medium leading-none transition-colors duration-150 sm:flex-row sm:gap-1.5 sm:text-[13px] ${FOCUS} ${
                      active ? ON : OFF
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="max-w-full truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
};

export default AppNav;
