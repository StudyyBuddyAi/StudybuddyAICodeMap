import { ReactNode, useState } from "react";
import AppNav from "@/components/dashboard/AppNav";
import AuthModal from "@/components/AuthModal";
import AccountDashboard from "@/components/AccountDashboard";

interface DashboardLayoutProps {
  children: ReactNode;
  wide?: boolean;
}

const DashboardLayout = ({ children, wide = false }: DashboardLayoutProps) => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
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
