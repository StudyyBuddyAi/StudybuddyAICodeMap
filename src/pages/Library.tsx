import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, FileText, Trash2, Search, Layers } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import DeckList from "@/components/DeckList";
import StudyMode from "@/components/StudyMode";
import OutputSection from "@/components/OutputSection";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { useStudyHistory, type StudyHistoryItem } from "@/hooks/use-study-history";
import { timeAgo } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type StudyFilter = { topic?: string; mode: "due" | "all-cards" | "deck" };

const Library = () => {
  const { toast } = useToast();
  const { allCards, dueCards, reviewCard, deleteCard } = useFlashcardDeck();
  const { history, deleteItem } = useStudyHistory();

  const [studyOpen, setStudyOpen] = useState(false);
  const [studyFilter, setStudyFilter] = useState<StudyFilter>({ mode: "deck" });
  const [activeSheet, setActiveSheet] = useState<StudyHistoryItem | null>(null);
  const [deckSearch, setDeckSearch] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const [visibleDecks, setVisibleDecks] = useState(10);
  const [visibleSheets, setVisibleSheets] = useState(10);

  useEffect(() => setVisibleDecks(10), [deckSearch]);
  useEffect(() => setVisibleSheets(10), [sheetSearch]);

  const filteredCards = useMemo(() => {
    if (!deckSearch.trim()) return allCards;
    return allCards.filter((c) =>
      (c.topic || "Untitled").toLowerCase().includes(deckSearch.toLowerCase())
    );
  }, [allCards, deckSearch]);

  const filteredSheets = useMemo(
    () =>
      sheetSearch.trim()
        ? history.filter(
            (h) =>
              h.topic.toLowerCase().includes(sheetSearch.toLowerCase()) ||
              (h.input || "").toLowerCase().includes(sheetSearch.toLowerCase())
          )
        : history,
    [history, sheetSearch]
  );

  const filteredTopics = useMemo(() => {
    const set = new Set<string>();
    for (const c of filteredCards) set.add(c.topic || "Untitled");
    return Array.from(set);
  }, [filteredCards]);

  const pagedTopics = filteredTopics.slice(0, visibleDecks);
  const pagedCards = filteredCards.filter((c) =>
    pagedTopics.includes(c.topic || "Untitled")
  );

  const totalDecks = filteredTopics.length;

  const handleStudyDeck = (topic: string) => {
    setStudyFilter({ mode: "deck", topic });
    setStudyOpen(true);
  };
  const handleReviewAll = () => {
    setStudyFilter({ mode: "all-cards" });
    setStudyOpen(true);
  };
  const handleDeleteDeck = (topic: string) => {
    const toDelete = allCards.filter((c) => c.topic === topic);
    toDelete.forEach((c) => deleteCard(c.id));
    toast({ title: `Deleted ${toDelete.length} cards from "${topic}"` });
  };

  const studySessionCards = useMemo(() => {
    if (studyFilter.mode === "all-cards") return allCards;
    if (studyFilter.mode === "deck" && studyFilter.topic) {
      return allCards.filter((c) => c.topic === studyFilter.topic);
    }
    return dueCards;
  }, [studyFilter, dueCards, allCards]);

  const handleDeleteSheet = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteItem(id);
  };

  return (
    <DashboardLayout wide>
      {studyOpen && (
        <StudyMode
          dueCards={studySessionCards}
          onReview={reviewCard}
          onClose={() => setStudyOpen(false)}
        />
      )}

      <div className="space-y-8">
        {/* Header — same voice as Sheets: mono eyebrow, serif headline, one-line lede. */}
        <div>
          <p
            className="mb-2 [font-family:var(--app-font-mono)] text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--color-accent)" }}
          >
            Library · Everything you've created
          </p>
          <h1
            className="[font-family:var(--app-font-serif)] text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-[-0.012em]"
            style={{ color: "var(--color-foreground)" }}
          >
            Your saved{" "}
            <span className="italic" style={{ color: "var(--color-accent)" }}>
              sheets and decks.
            </span>
          </h1>
          <p
            className="mt-2.5 max-w-xl text-base leading-relaxed"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            Every sheet you kept and every deck you built, in one place — search,
            reopen, or drill them again.
          </p>
        </div>

        {/* Tabs with counts */}
        <Tabs defaultValue="decks" className="w-full">
          <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-1">
            <TabsTrigger value="decks" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Decks
                <span className="text-xs font-medium text-muted-foreground">{totalDecks}</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="sheets" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Sheets
                <span className="text-xs font-medium text-muted-foreground">{history.length}</span>
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Decks Tab */}
          <TabsContent value="decks" className="pt-4">
            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search your decks…"
                value={deckSearch}
                onChange={(e) => setDeckSearch(e.target.value)}
                className="h-11 rounded-xl border-[color:var(--color-border)] bg-[color:var(--color-card)] pl-9 text-sm focus:border-primary focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Empty State */}
            {totalDecks === 0 ? (
              <div className="rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-sm">
                  <Sparkles className="h-5 w-5" strokeWidth={2.2} />
                </div>
                <div className="mt-4 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    No decks yet
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Generate flashcards from a topic to build your first deck.
                  </p>
                </div>
                <Link
                  to="/flashcards"
                  className="mt-5 inline-flex h-10 items-center rounded-xl bg-[color:var(--color-foreground)] px-5 text-sm font-semibold text-[color:var(--color-background)] shadow-[0_12px_24px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5"
                >
                  Create your first deck
                </Link>
              </div>
            ) : (
              <>
                <DeckList
                  cards={pagedCards}
                  onStudyDeck={handleStudyDeck}
                  onDeleteDeck={handleDeleteDeck}
                  onReviewAll={handleReviewAll}
                />
                {filteredTopics.length > visibleDecks && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setVisibleDecks((n) => n + 10)}
                      className="h-9 px-6 rounded-lg border border-border bg-transparent text-muted-foreground text-sm font-medium hover:border-input hover:text-foreground transition-colors"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Sheets Tab */}
          <TabsContent value="sheets" className="pt-4">
            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search your sheets…"
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                className="h-11 rounded-xl border-[color:var(--color-border)] bg-[color:var(--color-card)] pl-9 text-sm focus:border-primary focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Empty State */}
            {history.length === 0 ? (
              <div className="rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-sm">
                  <FileText className="h-5 w-5" strokeWidth={2.2} />
                </div>
                <div className="mt-4 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    No saved sheets yet
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Generate a study sheet and save it to see it here.
                  </p>
                </div>
                <Link
                  to="/sheets"
                  className="mt-5 inline-flex h-10 items-center rounded-xl bg-[color:var(--color-foreground)] px-5 text-sm font-semibold text-[color:var(--color-background)] shadow-[0_12px_24px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5"
                >
                  Generate your first study sheet
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSheets.slice(0, visibleSheets).map((item) => {
                  const preview =
                    (item.input || item.output)
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 160) ?? "";
                  return (
                    <div
                      key={item.id}
                      className="group relative flex cursor-pointer items-start gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent)] hover:shadow-[0_14px_28px_rgba(17,85,90,0.08)]"
                      onClick={() => setActiveSheet(item)}
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-foreground)] text-[color:var(--color-accent)]">
                        <FileText className="h-4 w-4" strokeWidth={2.2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.topic}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {preview}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {timeAgo(item.timestamp)}
                          {item.modeInfo && (
                            <span className="ml-1.5 opacity-60">· {item.modeInfo.examMode}</span>
                          )}
                        </p>
                      </div>
                      <button
                        className="opacity-0 w-8 h-8 flex items-center justify-center rounded-lg border-none bg-transparent cursor-pointer text-muted-foreground transition-opacity flex-shrink-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10"
                        onClick={(e) => handleDeleteSheet(item.id, e)}
                        aria-label="Delete sheet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {filteredSheets.length > visibleSheets && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setVisibleSheets((n) => n + 10)}
                      className="h-9 px-6 rounded-lg border border-border bg-transparent text-muted-foreground text-sm font-medium hover:border-input hover:text-foreground transition-colors"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={!!activeSheet}
        onOpenChange={(o) => !o && setActiveSheet(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{activeSheet?.topic}</DialogTitle>
          </DialogHeader>
          {activeSheet && (
            <ScrollArea className="max-h-[70vh] pr-2">
              <OutputSection
                output={activeSheet.output}
                inputText={activeSheet.input}
                modeInfo={activeSheet.modeInfo}
              />
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Library;
