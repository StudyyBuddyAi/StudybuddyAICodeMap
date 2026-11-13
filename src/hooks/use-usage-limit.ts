import { useDailyCredits } from "@/hooks/use-daily-credits";

/**
 * Free access: every account has one daily usage limit, spent on anything
 * (study sheets, flashcard decks, QBank questions) and back every day at
 * midnight UTC. It is the only limit a student meets, and it reads the same
 * count as the usage meter (use-daily-credits). The server is what holds it:
 * a request past the limit is refused with code "credits_exhausted".
 */
export function useDailyLimit() {
  const { credits, resetsIn, isLoading, refetch } = useDailyCredits();
  return {
    /** Today's usage limit is used up. */
    reached: credits?.level === "out",
    /** Whole percent of today's usage limit used. */
    percent: credits?.percent ?? 0,
    resetsIn,
    isLoading,
    refresh: () => void refetch(),
  };
}
