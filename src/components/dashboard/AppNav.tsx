import { useState, useEffect } from "react";
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
  HeartPulse,
  ArrowRight,
  ArrowUpRight,
  Moon,
  Sun,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import GoProModal from "@/components/GoProModal";
import "./AppNav.css";

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
  { to: "/", label: "Home", icon: LayoutDashboard },
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
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem("studybuddy-theme") === "dark";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      localStorage.setItem("studybuddy-theme", isDark ? "dark" : "light");
    } catch {
      // Storage can be unavailable in private browsing; theme still works in-memory.
    }
  }, [isDark]);

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
        className={`site-header ${mobileOpen ? "menu-open" : ""}`}
      >
        <div className="header-inner">
          <Link
            to="/dashboard"
            onClick={handleNav}
            className="brand"
            aria-label="StudyBuddy AI home"
          >
            <span className="brand-mark"><HeartPulse size={18} strokeWidth={2.25} /></span>
            <span className="brand-name">StudyBuddy <b>AI</b></span>
            <span className="brand-beta">BETA</span>
          </Link>
          
          {/* Desktop nav links */}
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navItems.map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={handleNav}
                  aria-current={active ? "page" : undefined}
                  className={active ? "active" : ""}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop right actions */}
          <div className="header-actions">
            <button 
              className="theme-button" 
              type="button" 
              onClick={() => setIsDark((value) => !value)} 
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {isPro && (
              <span className="pro-badge">Pro</span>
            )}

            {!isAnonymous && user && (
              <button
                onClick={onOpenAccount}
                title="Settings"
                aria-label="Settings"
                className="icon-button"
              >
                <Settings size={16} />
              </button>
            )}

            {isAnonymous || !user ? (
              <button
                onClick={onOpenAuth}
                className="cta-button"
              >
                <LogIn size={14} />
                Sign in
              </button>
            ) : (
              <button
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="icon-button"
              >
                <LogOut size={16} />
              </button>
            )}

            <button 
              className="menu-button" 
              type="button" 
              onClick={() => setMobileOpen((value) => !value)} 
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={handleNav}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
              >
                {item.label}
                <ArrowUpRight size={14} />
              </Link>
            );
          })}

          <div className="mobile-actions">
            <button 
              className="mobile-action-button" 
              type="button" 
              onClick={() => setIsDark((value) => !value)} 
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
              {isDark ? "Light Mode" : "Dark Mode"}
            </button>

            {!isAnonymous && user && (
              <button
                onClick={() => {
                  onOpenAccount();
                  setMobileOpen(false);
                }}
                className="mobile-action-button"
              >
                <Settings size={14} />
                Settings
              </button>
            )}

            {!isAnonymous && user ? (
              <button
                onClick={handleSignOut}
                className="mobile-action-button"
              >
                <LogOut size={14} />
                Sign out
              </button>
            ) : (
              <button
                onClick={() => {
                  onOpenAuth();
                  setMobileOpen(false);
                }}
                className="mobile-action-button cta-button"
              >
                <LogIn size={14} />
                Sign in
              </button>
            )}
          </div>
        </nav>
      </header>

      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </>
  );
};

export default AppNav;
