import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Library as LibraryIcon, Sparkles, FileText, Trash2, Search, Check, Layers, Clock, Star, Filter, ArrowRight, Heart, Bookmark } from "lucide-react";
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
    <DashboardLayout>
      {studyOpen && (
        <StudyMode
          dueCards={studySessionCards}
          onReview={reviewCard}
          onClose={() => setStudyOpen(false)}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
              <LibraryIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-primary">
                Library · Everything you've created
              </p>
              <h1 className="text-2xl lg:text-3xl font-serif font-medium leading-tight tracking-tight text-foreground">
                Your saved{" "}
                <span className="italic text-primary">sheets and decks.</span>
              </h1>
            </div>
          </div>
        </div>

        {/* Tabs with counts */}
        <Tabs defaultValue="decks" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary border border-border rounded-lg p-1">
            <TabsTrigger value="decks" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Decks
                <span className="text-xs font-medium text-muted-foreground">{totalDecks}</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="sheets" className="data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
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
                placeholder="Search your sheets and flashcards…"
                value={deckSearch}
                onChange={(e) => setDeckSearch(e.target.value)}
                className="pl-9 h-10 rounded-lg border-border bg-card text-sm focus:border-primary focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Empty State */}
            {totalDecks === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl border border-border bg-card mx-auto">
                  <Sparkles className="w-6 h-6 text-primary" />
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
                  to="/dashboard"
                  className="inline-flex items-center h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors mt-4"
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
                placeholder="Search your sheets and flashcards…"
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                className="pl-9 h-10 rounded-lg border-border bg-card text-sm focus:border-primary focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Empty State */}
            {history.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl border border-border bg-card mx-auto">
                  <FileText className="w-6 h-6 text-primary" />
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
                  to="/dashboard"
                  className="inline-flex items-center h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors mt-4"
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
                      className="group relative rounded-xl border border-border bg-card p-3.5 flex items-start gap-3 cursor-pointer hover:border-primary transition-colors shadow-sm"
                      onClick={() => setActiveSheet(item)}
                    >
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card flex-shrink-0">
                        <FileText className="w-4 h-4 text-primary" />
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
