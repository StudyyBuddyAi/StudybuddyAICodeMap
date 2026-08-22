import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { QBankProvider } from "./contexts/QBankContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import TopProgressBar from "@/components/TopProgressBar";
import PageLoader from "@/components/PageLoader";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";

// Route pages are lazy-loaded so the heavy page chunks (Sheets, Flashcards,
// QBank family) are only fetched on navigation instead of in the initial bundle.
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Library = lazy(() => import("./pages/Library.tsx"));
const Roadmap = lazy(() => import("./pages/Roadmap.tsx"));
const Sheets = lazy(() => import("./pages/Sheets.tsx"));
const Flashcards = lazy(() => import("./pages/Flashcards.tsx"));
const QBank = lazy(() => import("./pages/QBank.tsx"));
const QBankSession = lazy(() => import("./pages/QBankSession.tsx"));
const QBankSummary = lazy(() => import("./pages/QBankSummary.tsx"));

const queryClient = new QueryClient();

const EXIT_DURATION_MS = 150;

/**
 * Route transition wrapper: on pathname change the current page fades out
 * (150ms), then the new page fades in and slides up 8px (200ms).
 * Transform/opacity only — no layout shift. Same-path location changes
 * (query params) swap without animating.
 */
const AppRoutes = () => {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [stage, setStage] = useState<"enter" | "exit">("enter");

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) {
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
      <Suspense fallback={<PageLoader context="generic" />}>
        <Routes location={displayLocation}>
          <Route path="/" element={<Index />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route element={<QBankProvider><Outlet /></QBankProvider>}>
            <Route path="/qbank" element={<QBank />} />
            <Route path="/qbank/session" element={<QBankSession />} />
            <Route path="/qbank/summary" element={<QBankSummary />} />
          </Route>
          <Route path="/guidelines" element={<Navigate to="/sheets" replace />} />
          <Route path="/library" element={<Library />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
