import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { formatPlanDate } from "@/lib/format-plan-date";

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Sign in first, then enter your code.",
  account_required: "Sign in or create an account first — a code unlocks Pro on an account.",
  invalid_code: "That code isn't valid. Check it and try again.",
  already_redeemed: "This code has already been used.",
};

/**
 * Turns a Pro access code into Pro on this account. Shared by Settings and the
 * Go Pro dialog, so a student who already has a code can use it from either.
 */
const RedeemCodeForm = ({ onRedeemed, autoFocus = false }: { onRedeemed?: () => void; autoFocus?: boolean }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("redeem_pro_code", { code_input: code.trim() });
      if (rpcError) {
        setError("Couldn't check that code. Please try again.");
        return;
      }
      const result = data as { success: boolean; error?: string; expires_at?: string } | null;
      if (!result || !result.success) {
        setError(ERROR_MESSAGES[result?.error ?? ""] ?? "Couldn't redeem that code. Please try again.");
        return;
      }
      toast({
        title: result.expires_at ? `Pro activated until ${formatPlanDate(result.expires_at)}` : "Pro activated",
      });
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["profile", user?.id ?? null] });
      onRedeemed?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleRedeem} className="space-y-2">
      <label htmlFor={inputId} className="sr-only">
        Pro access code
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="Enter code"
          autoFocus={autoFocus}
          disabled={loading}
          className="font-mono uppercase tracking-wider"
        />
        <Button type="submit" disabled={loading || !code.trim()}>
          {loading ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              Redeeming…
            </>
          ) : (
            "Redeem"
          )}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
};

export default RedeemCodeForm;
