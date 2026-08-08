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
import { Library as LibraryIcon, Sparkles, FileText, Trash2, Search } from "lucide-react";
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
        <div style={{ marginBottom: 28 }}>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 8,
          }}>
            Library · Everything you've created
          </p>
          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(26px, 3.5vw, 36px)",
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.012em",
            color: "var(--fg)",
            margin: 0,
          }}>
            Your saved{" "}
            <span style={{ fontStyle: "italic", color: "var(--accent)" }}>sheets and decks.</span>
          </h1>
        </div>

        <Tabs defaultValue="decks" className="w-full">
          <TabsList
            className="grid w-full grid-cols-2"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 3,
            }}
          >
            <TabsTrigger value="decks">Decks</TabsTrigger>
            <TabsTrigger value="sheets">Sheets</TabsTrigger>
          </TabsList>

          <TabsContent value="decks" className="pt-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search decks…"
                value={deckSearch}
                onChange={(e) => setDeckSearch(e.target.value)}
                className="pl-9 h-10"
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                }}
              />
            </div>
            {totalDecks === 0 ? (
              <div style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                background: "var(--bg-elevated)",
                padding: "32px 24px",
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center",
                textAlign: "center" as const,
                gap: 12,
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                }}>
                  <Sparkles style={{ width: 18, height: 18, color: "var(--accent)" }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--fg)", marginBottom: 4 }}>
                    No decks yet
                  </p>
                  <p style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>
                    Generate flashcards from a topic to build your first deck.
                  </p>
                </div>
                <Link
                  to="/dashboard"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 36,
                    padding: "0 20px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid transparent",
                    background: "var(--fg)",
                    color: "var(--bg)",
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: "none",
                    marginTop: 4,
                  }}
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
                      style={{
                        height: 36,
                        padding: "0 24px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--fg-muted)",
                        fontFamily: "var(--font-sans)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "border-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out)",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
                        (e.currentTarget as HTMLElement).style.color = "var(--fg)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                        (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)";
                      }}
                    >
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="sheets" className="pt-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search sheets…"
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                className="pl-9 h-10"
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                }}
              />
            </div>
            {history.length === 0 ? (
              <div style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                background: "var(--bg-elevated)",
                padding: "32px 24px",
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center",
                textAlign: "center" as const,
                gap: 12,
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                }}>
                  <FileText style={{ width: 18, height: 18, color: "var(--accent)" }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--fg)", marginBottom: 4 }}>
                    No saved sheets yet
                  </p>
                  <p style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>
                    Generate a study sheet and save it to see it here.
                  </p>
                </div>
                <Link
                  to="/dashboard"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 36,
                    padding: "0 20px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid transparent",
                    background: "var(--fg)",
                    color: "var(--bg)",
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: "none",
                    marginTop: 4,
                  }}
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
                      className="group"
                      onClick={() => setActiveSheet(item)}
                      style={{
                        position: "relative",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--bg-elevated)",
                        padding: "14px 16px",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        cursor: "pointer",
                        transition: "border-color var(--dur-micro) var(--ease-out)",
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
                    >
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        flexShrink: 0,
                      }}>
                        <FileText style={{ width: 16, height: 16, color: "var(--accent)" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {item.topic}
                        </p>
                        <p style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
                          {preview}
                        </p>
                        <p style={{ fontSize: 11, color: "var(--fg-subtle)", marginTop: 4 }}>
                          {timeAgo(item.timestamp)}
                          {item.modeInfo && (
                            <span style={{ marginLeft: 6, opacity: 0.6 }}>· {item.modeInfo.examMode}</span>
                          )}
                        </p>
                      </div>
                      <button
                        style={{
                          opacity: 0,
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "var(--radius-sm)",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "var(--fg-muted)",
                          transition: "opacity var(--dur-micro) var(--ease-out)",
                          flexShrink: 0,
                        }}
                        className="group-hover:opacity-100"
                        onClick={(e) => handleDeleteSheet(item.id, e)}
                        aria-label="Delete sheet"
                      >
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  );
                })}
                {filteredSheets.length > visibleSheets && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setVisibleSheets((n) => n + 10)}
                      style={{
                        height: 36,
                        padding: "0 24px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--fg-muted)",
                        fontFamily: "var(--font-sans)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "border-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out)",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
                        (e.currentTarget as HTMLElement).style.color = "var(--fg)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                        (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)";
                      }}
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
