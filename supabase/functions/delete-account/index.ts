import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { handleDeleteAccount } from "../_shared/delete-account.ts";

// Deletes the calling user's account and all their data (see
// _shared/delete-account.ts for what cascades and what is kept).
// POST with the user's access token and { "confirm": "DELETE" }.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "delete-account", event, ...fields }));
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const body = await req.json().catch(() => null);
  const result = await handleDeleteAccount(req.headers.get("Authorization"), body, {
    userFromToken: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    deleteUser: async (id) => {
      // Hard delete: the rows go, not just the login.
      const { error } = await admin.auth.admin.deleteUser(id, false);
      return { error: error ? error.message : null };
    },
    log,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
