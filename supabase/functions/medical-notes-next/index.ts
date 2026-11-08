// Staging copy of medical-notes: the same handler under another name, so a
// build can be exercised against production data (VITE_MEDICAL_NOTES_FN=
// medical-notes-next in .env.local) before medical-notes itself is deployed.
// Nothing in production calls it, so only STAFF_USER_IDS may (_shared/staff.ts):
// it runs the real writer, and must not be a second door to it for everyone.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleMedicalNotes } from "../_shared/medical-notes-handler.ts";

serve((req) => handleMedicalNotes(req, { staffOnly: true, fn: "medical-notes-next" }));
