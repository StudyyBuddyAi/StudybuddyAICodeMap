// First: captures a password-reset link before the Supabase client clears it.
import "./lib/recovery-landing";
import { createRoot } from "react-dom/client";
import "./styles/openmed-tokens.css";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(<App />);
