import { ReactNode, useState } from "react";
import AppNav from "@/components/dashboard/AppNav";
import AuthModal from "@/components/AuthModal";
import AccountDashboard from "@/components/AccountDashboard";

/**
 * How wide the content column is.
 *
 * Replaces a `wide?: boolean`, which only had two settings and no stated
 * meaning — so Dashboard, Library, Roadmap and QBank all defaulted to the
 * narrow column while Sheets and Flashcards opted out, and navigating between
 * them snapped the column from 860px to 1280px. Worse, two of the narrow pages
 * then fought the container: QBank put a 320px rail inside 860px, and Roadmap
 * rendered a three-column grid in it.
 *
 * - `reader` — a single column of prose. Sheets read at this width.
 * - `app`    — multi-pane tools that need room: split panes, side rails.
 * - `full`   — edge to edge; the page owns its own gutters.
 */
export type LayoutWidth = "reader" | "app" | "full";

const MAX_WIDTH: Record<LayoutWidth, string> = {
  reader: "860px",
  app: "var(--max-w, 1280px)",
  full: "none",
};

interface DashboardLayoutProps {
  /**
   * Render-prop form so a page can open the auth modal this layout already
   * mounts. QBank's "Sign in to start" button used to `navigate("/dashboard")`
   * instead — it left the page without ever showing a sign-in form, which was a
   * dead end for every anonymous visitor.
   */
  children: ReactNode | ((api: DashboardLayoutApi) => ReactNode);
  width?: LayoutWidth;
}

export interface DashboardLayoutApi {
  openAuth: () => void;
  openAccount: () => void;
}

const DashboardLayout = ({
  children,
  width = "reader",
}: DashboardLayoutProps) => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  const api: DashboardLayoutApi = {
    openAuth: () => setAuthModalOpen(true),
    openAccount: () => setAccountModalOpen(true),
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenAccount={() => setAccountModalOpen(true)}
      />

      {/* The layout owns the gutter. Pages must not add their own on top of
          it — Roadmap used to, and its cards ended up in doubled gutters. */}
      <main style={{ padding: "40px 24px 80px" }}>
        <div
          style={{
            maxWidth: MAX_WIDTH[width],
            margin: "0 auto",
          }}
        >
          {typeof children === "function" ? children(api) : children}
        </div>
      </main>

      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <AccountDashboard open={accountModalOpen} onOpenChange={setAccountModalOpen} />
    </div>
  );
};

export default DashboardLayout;
