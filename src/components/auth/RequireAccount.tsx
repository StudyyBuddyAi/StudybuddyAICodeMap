import { useState } from "react";
import { Link, Outlet, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AuthModal from "@/components/AuthModal";
import BrandMark from "@/components/brand/BrandMark";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

/**
 * Every app page sits behind this: using StudyBuddy takes an account, so each
 * student's usage is their own. Signed in, it renders the page. Signed out,
 * or still a guest from before accounts were required, it shows the account
 * screen in the page's place, at the same address, so the page they asked
 * for opens the moment they are in (a "Start free" link still lands in the
 * sheet composer). The landing page, the memorial and the privacy policy
 * are outside it.
 */
const RequireAccount = () => {
  const { user, isAnonymous, loading } = useAuth();
  if (loading) return <PageLoader context="generic" />;
  if (!user || isAnonymous) return <AccountGate guest={isAnonymous} />;
  return <Outlet />;
};

/**
 * The account screen. It opens the sign-in dialog on arrival, on "Sign up",
 * or on "Sign in" when the visitor came from a sign-in link (?signin=1); the
 * two buttons reopen it on either tab after it is closed.
 */
export const AccountGate = ({ guest = false }: { guest?: boolean }) => {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"signin" | "signup">(params.get("signin") === "1" ? "signin" : "signup");
  const [open, setOpen] = useState(true);
  const openOn = (t: "signin" | "signup") => {
    setTab(t);
    setOpen(true);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <Link to="/" aria-label="StudyBuddy AI home" className="flex items-center gap-2.5 rounded-md">
          <BrandMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">StudyBuddy AI</span>
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to StudyBuddy
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-20 pt-[10vh]">
        <section
          aria-labelledby="account-gate-title"
          className="w-full max-w-[460px] rounded-[var(--r-sheet)] border border-border bg-[color:var(--bg-elevated)] p-7 shadow-[var(--shadow-sheet)] sm:p-10"
        >
          <BrandMark size={40} />
          <h1
            id="account-gate-title"
            className="mt-5 font-display text-[clamp(26px,3vw,32px)] font-medium leading-[1.15] tracking-[-0.012em] text-foreground"
          >
            {guest ? "Keep going with a free account" : "Create your free account"}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
            {guest
              ? "StudyBuddy now works with an account. Create one to carry on: everything you have made so far moves into it."
              : "StudyBuddy works with an account, so your sheets, flashcards and QBank progress are kept for you. Sign up or sign in to start."}
          </p>
          <div className="mt-7 grid gap-2.5">
            <Button size="lg" onClick={() => openOn("signup")}>
              Create a free account
            </Button>
            <Button size="lg" variant="outline" onClick={() => openOn("signin")}>
              Sign in
            </Button>
          </div>
        </section>
      </main>

      <AuthModal open={open} onOpenChange={setOpen} initialTab={tab} />
    </div>
  );
};

export default RequireAccount;
