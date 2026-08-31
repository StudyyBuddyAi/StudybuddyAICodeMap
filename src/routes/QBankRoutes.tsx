import { Outlet } from "react-router-dom";
import { QBankProvider } from "@/contexts/QBankContext";

/**
 * Layout route for the QBank family.
 *
 * Exists so `QBankProvider` — and through it the Supabase client — is reached
 * only from a lazily-loaded chunk. Importing the provider directly in App.tsx
 * put that dependency in the entry graph for every visitor, even though the
 * provider renders on three routes.
 */
const QBankRoutes = () => (
  <QBankProvider>
    <Outlet />
  </QBankProvider>
);

export default QBankRoutes;
