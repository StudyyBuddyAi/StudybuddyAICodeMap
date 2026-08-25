import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDeckGrounding, type Card as DeckCard } from "@/hooks/use-flashcard-deck";
import type { GroundingLevel } from "@/types/generated-sheet";

interface DeckListProps {
  cards: DeckCard[];
  onStudyDeck: (topic: string) => void;
  onDeleteDeck: (topic: string) => void;
  onReviewAll: () => void;
}

const PALETTE = [
  { bg: "bg-slate-500/20", text: "text-slate-500/80 dark:text-slate-300" },
  { bg: "bg-violet-500/20", text: "text-violet-500/80 dark:text-violet-300" },
  { bg: "bg-teal-500/20", text: "text-teal-500/80 dark:text-teal-300" },
  { bg: "bg-rose-500/20", text: "text-rose-500/80 dark:text-rose-300" },
  { bg: "bg-amber-500/20", text: "text-amber-500/80 dark:text-amber-300" },
  { bg: "bg-sky-500/20", text: "text-sky-500/80 dark:text-sky-300" },
];

function hashTopic(topic: string): number {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = (h * 31 + topic.charCodeAt(i)) >>> 0;
  }
  return h;
}

interface DeckSummary {
  topic: string;
  total: number;
  mastered: number;
  due: number;
  latest: number;
  grounded: number;
  emoji?: string;
}

const GROUNDING_BADGES: Record<GroundingLevel, { label: string; className: string; title: string }> = {
  full: {
    label: "Grounded",
    className: "border-success/40 bg-success/10 text-success",
    title: "Every card in this deck was built from a retrieved clinical guideline.",
  },
  partial: {
    label: "Partial",
    className: "border-warning/40 bg-warning/10 text-warning",
    title: "Some cards in this deck were written from general medical knowledge.",
  },
  none: {
    label: "Unverified",
    className: "border-border bg-transparent text-muted-foreground",
    title: "No guideline context backed this deck — verify before exam use.",
  },
};

/**
 * Grounding badge for one deck.
 *
 * Prefers the deck's stored `grounding_metadata` (server accounts). Falls back
 * to aggregating each card's own `grounded` flag, which is the only signal
 * available for localStorage decks and for decks saved before the metadata
 * column existed.
 */
const DeckGroundingBadge = ({ deck }: { deck: DeckSummary }) => {
  const { data: meta } = useDeckGrounding(deck.topic);

  const level: GroundingLevel =
    meta?.groundingLevel ??
    (deck.grounded === 0 ? "none" : deck.grounded === deck.total ? "full" : "partial");

  const badge = GROUNDING_BADGES[level];
  return (
    <span
      title={badge.title}
      className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border ${badge.className}`}
    >
      {badge.label}
    </span>
  );
};

const DeckList = ({ cards, onStudyDeck, onDeleteDeck, onReviewAll }: DeckListProps) => {
  const [pendingDelete, setPendingDelete] = useState<DeckSummary | null>(null);

  const decks = useMemo<DeckSummary[]>(() => {
    const now = Date.now();
    const map = new Map<string, DeckSummary>();
    for (const c of cards) {
      const key = c.topic || "Untitled";
      const cur = map.get(key) ?? { topic: key, total: 0, mastered: 0, due: 0, latest: 0, grounded: 0, emoji: undefined as string | undefined };
      cur.total += 1;
      if (c.grounded) cur.grounded += 1;
      if (c.interval >= 21) cur.mastered += 1;
      if (c.dueAt <= now) cur.due += 1;
      if (c.createdAt > cur.latest) cur.latest = c.createdAt;
      if (!cur.emoji && c.topicEmoji) cur.emoji = c.topicEmoji;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.latest - a.latest);
  }, [cards]);

  if (cards.length === 0) return null;

  return (
    <>
      <div
        className="animate-fade-in"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-elevated)",
          padding: "20px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="flex items-center justify-between">
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
            }}>
              My Decks
            </span>
            <button
              type="button"
              onClick={onReviewAll}
              disabled={decks.length < 2}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: 500,
                cursor: decks.length < 2 ? "not-allowed" : "pointer",
                opacity: decks.length < 2 ? 0.4 : 1,
              }}
            >
              Mix All Decks
            </button>
          </div>
          <div className="space-y-1">
            {decks.map((deck) => {
              const color = PALETTE[hashTopic(deck.topic) % PALETTE.length];
              const ratio = deck.total > 0 ? (deck.mastered / deck.total) * 100 : 0;
              const initial = (deck.topic[0] || "?").toUpperCase();
              return (
                <div
                  key={deck.topic}
                  style={{
                    borderRadius: "var(--radius-sm)",
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    transition: "background var(--dur-micro) var(--ease-out)",
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-panel)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                >
                  <button
                    onClick={() => onStudyDeck(deck.topic)}
                    className="flex-1 flex items-center gap-3 text-left cursor-pointer min-w-0"
                  >
                    <div
                      className={`h-8 w-8 shrink-0 rounded-md flex items-center justify-center font-semibold text-sm ${color.bg} ${color.text}`}
                    >
                      {deck.emoji || initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {deck.topic}
                        </p>
                        <DeckGroundingBadge deck={deck} />
                      </div>
                      <p style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 1 }}>
                        {deck.total} cards · {deck.mastered} mastered
                        {deck.due > 0 ? ` · ${deck.due} due` : ""}
                      </p>
                    </div>
                    <div className="hidden sm:block w-20 h-1 rounded-full overflow-hidden shrink-0" style={{ background: "var(--border)" }}>
                      <div className="h-full" style={{ width: `${ratio}%`, background: "var(--accent)" }} />
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onStudyDeck(deck.topic)}>
                        Study deck
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setPendingDelete(deck)}
                        className="text-destructive focus:text-destructive"
                      >
                        Delete deck
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deck?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all {pendingDelete?.total} cards in "
              {pendingDelete?.topic}". This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) onDeleteDeck(pendingDelete.topic);
                setPendingDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DeckList;