import { ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppNav from "@/components/dashboard/AppNav";
import AppFooter from "@/components/layout/AppFooter";
import AuthModal from "@/components/AuthModal";
import AccountDashboard from "@/components/AccountDashboard";
import { useAuth } from "@/hooks/use-auth";
import { useBackdropScene } from "@/components/backdrop/backdrop-scene";

interface DashboardLayoutProps {
  children: ReactNode;
  wide?: boolean;
}

const DashboardLayout = ({ children, wide = false }: DashboardLayoutProps) => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAnonymous, loading } = useAuth();
  // The landing page's "Sign in" links here with ?signin=1. Someone already
  // signed in just lands on the dashboard.
  useEffect(() => {
    if (loading || searchParams.get("signin") !== "1") return;
    if (!user || isAnonymous) setAuthModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("signin");
    setSearchParams(next, { replace: true });
  }, [loading, user, isAnonymous, searchParams, setSearchParams]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  // Every app page gets the living backdrop; a page with its own scene (a
  // sheet, a QBank session) outranks this calm default.
  useBackdropScene({ mode: "ambient" }, 0);

  return (
    // Transparent: the app backdrop behind it paints the page colour.
    <div className="flex min-h-screen flex-col">
      <AppNav
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenAccount={() => setAccountModalOpen(true)}
      />

      <main className="flex-1" style={{ padding: "40px 24px 80px" }}>
        <div
          style={{
            maxWidth: wide ? "var(--max-w, 1280px)" : "1600px",
            margin: "0 auto",
          }}
        >
          {children}
        </div>
      </main>

      <AppFooter />

      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <AccountDashboard
        open={accountModalOpen}
        onOpenChange={setAccountModalOpen}
        onOpenAuth={() => setAuthModalOpen(true)}
      />
    </div>
  );
};

export default DashboardLayout;
