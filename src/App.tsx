import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { QBankProvider } from "./contexts/QBankContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import TopProgressBar from "@/components/TopProgressBar";
import Index from "./pages/Index.tsx";
import Home from "./pages/Home.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Library from "./pages/Library.tsx";
import NotFound from "./pages/NotFound.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Roadmap from "./pages/Roadmap.tsx";
import Sheets from "./pages/Sheets.tsx";
import Flashcards from "./pages/Flashcards.tsx";
import QBank from "./pages/QBank.tsx";
import QBankSession from "./pages/QBankSession.tsx";
import QBankSummary from "./pages/QBankSummary.tsx";

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
      <Routes location={displayLocation}>
        <Route path="/" element={<Index />} />
        <Route path="/home" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/sheets" element={<Sheets />} />
        <Route path="/flashcards" element={<Flashcards />} />
        <Route element={<QBankProvider><Outlet /></QBankProvider>}>
          <Route path="/qbank" element={<QBank />} />
          <Route path="/qbank/session" element={<QBankSession />} />
          <Route path="/qbank/summary" element={<QBankSummary />} />
        </Route>
        <Route path="/library" element={<Library />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
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
