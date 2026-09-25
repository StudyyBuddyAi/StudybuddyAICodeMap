import { ReactNode, useState } from "react";
import AppNav from "@/components/dashboard/AppNav";
import AuthModal from "@/components/AuthModal";
import AccountDashboard from "@/components/AccountDashboard";
import { useBackdropScene } from "@/components/backdrop/backdrop-scene";

interface DashboardLayoutProps {
  children: ReactNode;
  wide?: boolean;
}

const DashboardLayout = ({ children, wide = false }: DashboardLayoutProps) => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  // Every app page gets the living backdrop; a page with its own scene (a
  // sheet, a QBank session) outranks this calm default.
  useBackdropScene({ mode: "ambient" }, 0);

  return (
    // Transparent: the app backdrop behind it paints the page colour.
    <div className="min-h-screen">
      <AppNav
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenAccount={() => setAccountModalOpen(true)}
      />

      <main style={{ padding: "40px 24px 80px" }}>
        <div
          style={{
            maxWidth: wide ? "var(--max-w, 1280px)" : "1600px",
            margin: "0 auto",
          }}
        >
          {children}
        </div>
      </main>

      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <AccountDashboard open={accountModalOpen} onOpenChange={setAccountModalOpen} />
    </div>
  );
};

export default DashboardLayout;
