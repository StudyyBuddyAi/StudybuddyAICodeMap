import { useDailyLimit } from "@/hooks/use-usage-limit";

/**
 * One line on the day's usage limit, the same under every tool: how much of
 * it is used and when it resets. Every account has the one limit, spent on
 * sheets, decks and questions alike.
 */
export function UsageLimitLine({ className = "" }: { className?: string }) {
  const { reached, percent, resetsIn, isLoading } = useDailyLimit();
  if (isLoading) return null;
  return (
    <p className={`text-xs leading-relaxed text-muted-foreground ${className}`}>
      {reached ? (
        <span className="font-medium text-warning">Today's usage limit is used up · it resets in {resetsIn}</span>
      ) : (
        <span>
          {percent}% of today's usage limit used · resets in {resetsIn}
        </span>
      )}
    </p>
  );
}
