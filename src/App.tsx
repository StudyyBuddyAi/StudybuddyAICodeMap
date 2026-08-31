import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import TopProgressBar from "@/components/TopProgressBar";
import PageLoader from "@/components/PageLoader";
import ErrorBoundary from "@/components/ErrorBoundary";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

// Route pages are lazy-loaded so the heavy page chunks (Sheets, Flashcards,
// QBank family) are only fetched on navigation instead of in the initial bundle.
const Home = lazy(() => import("./pages/Home.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Library = lazy(() => import("./pages/Library.tsx"));
const Roadmap = lazy(() => import("./pages/Roadmap.tsx"));
const Sheets = lazy(() => import("./pages/Sheets.tsx"));
const Flashcards = lazy(() => import("./pages/Flashcards.tsx"));
const QBank = lazy(() => import("./pages/QBank.tsx"));
const QBankSession = lazy(() => import("./pages/QBankSession.tsx"));
const QBankSummary = lazy(() => import("./pages/QBankSummary.tsx"));
// Lazy for a reason, not for consistency: ResetPassword statically imports the
// Supabase client, and being eagerly imported here dragged that 54 kB (gzipped)
// chunk into the entry graph for every visitor — including the marketing page,
// which never touches Supabase. It is a rarely-hit email-link destination.
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const QBankRoutes = lazy(() => import("./routes/QBankRoutes.tsx"));

const queryClient = new QueryClient();

const EXIT_DURATION_MS = 150;

/** True when the viewer has asked for less motion, or we can't tell. */
const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Route transition wrapper: on pathname change the current page fades out
 * (150ms), then the new page fades in and slides up 8px (200ms).
 * Transform/opacity only — no layout shift. Same-path location changes
 * (query params) swap without animating.
 *
 * The exit fade is real latency added to every navigation, so it is skipped
 * entirely under `prefers-reduced-motion` rather than only having its CSS
 * neutralised — previously the animation was hidden but the 150ms wait still
 * happened, which is the cost without the effect.
 */
const AppRoutes = () => {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [stage, setStage] = useState<"enter" | "exit">("enter");

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) {
      if (prefersReducedMotion()) {
        setDisplayLocation(location);
        setStage("enter");
        window.scrollTo(0, 0);
        return;
      }
      setStage("exit");
      const t = window.setTimeout(() => {
        setDisplayLocation(location);
        setStage("enter");
        window.scrollTo(0, 0);
      }, EXIT_DURATION_MS);
      return () => window.clearTimeout(t);
    }
    if (location !== displayLocation) {
      setDisplayLocation(location);
    }
  }, [location, displayLocation]);

  return (
    <div className={stage === "exit" ? "page-transition-exit" : "page-transition-enter"}>
      {/* Inside the transition wrapper and keyed to the path, so an error on one
          route doesn't strand every later navigation behind the same panel. */}
      <ErrorBoundary resetKey={displayLocation.pathname}>
      <Suspense fallback={<PageLoader context="generic" />}>
        <Routes location={displayLocation}>
          <Route path="/" element={<Index />} />
          <Route path="/home" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/flashcards" element={<Flashcards />} />
          {/* The provider travels inside the QBank chunk rather than being
              imported at the root. It only ever renders on these three routes,
              but a static import put its Supabase edge in the entry graph. */}
          <Route element={<QBankRoutes />}>
            <Route path="/qbank" element={<QBank />} />
            <Route path="/qbank/session" element={<QBankSession />} />
            <Route path="/qbank/summary" element={<QBankSummary />} />
          </Route>
          <Route path="/library" element={<Library />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <TopProgressBar />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
