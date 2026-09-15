// Staging copy of medical-notes: the same handler under another name, so a
// build can be exercised against production data (VITE_MEDICAL_NOTES_FN=
// medical-notes-next in .env.local) before medical-notes itself is deployed.
// Nothing in production calls it.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleMedicalNotes } from "../_shared/medical-notes-handler.ts";

serve(handleMedicalNotes);
