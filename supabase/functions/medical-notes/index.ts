// Study sheets, flashcard decks, explain and enhance. The handler lives in
// _shared/medical-notes-handler.ts so a staging copy (medical-notes-next) can
// serve the identical code under a different name.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleMedicalNotes } from "../_shared/medical-notes-handler.ts";

serve(handleMedicalNotes);