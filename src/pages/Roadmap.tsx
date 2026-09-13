import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  Compass,
  Layers,
  Menu,
  Search,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  useCurriculumProgress,
  type TopicState,
} from "@/hooks/use-curriculum-progress";
import "@/index.css"; // for the `--card` and `--secondary` tokens used in the roadmaph
type CurriculumTopic = Database["public"]["Tables"]["curriculum_topics"]["Row"];

interface SystemSection {
  system: string;
  topics: CurriculumTopic[];
}

/**
 * Level-0 rows name a system; level-1 rows are its topics. Sections follow the
 * order their level-0 row appears in, and a system with topics but no level-0
 * row still renders rather than silently vanishing.
 */
const groupBySystem = (rows: CurriculumTopic[]): SystemSection[] => {
  const sections = new Map<string, SystemSection>();
  for (const row of rows) {
    let section = sections.get(row.system);
    if (!section) {
      section = { system: row.system, topics: [] };
      sections.set(row.system, section);
    }
    if (row.level > 0) section.topics.push(row);
  }
  return [...sections.values()].filter((s) => s.topics.length > 0);
};

/**
 * One emoji per body system. The emoji carries the colour, so the chrome
 * around it stays on the app's own `primary` token rather than a per-system
 * palette. First match wins, so the more specific names (psychiatry before
 * neurology, haematology before "blood") sit higher in the list.
 */
const SYSTEM_EMOJI = [
  { test: /(cardio|heart)/, emoji: "🫀" },
  { test: /(musculo|skin|bone)/, emoji: "🦴" },
  { test: /(hemat|onc)/, emoji: "🩸" },
  { test: /(blood|lymph|immun)/, emoji: "🧬" },
  { test: /(psych|behav)/, emoji: "💭" },
  { test: /(neuro|brain)/, emoji: "🧠" },
  { test: /(resp|lung|pulm)/, emoji: "🫁" },
  { test: /(endo|horm|thyroid)/, emoji: "🧪" },
  { test: /(gastro|digest|intestin)/, emoji: "🍽️" },
  { test: /(renal|urinary|kidney|nephro)/, emoji: "🫘" },
  { test: /(pedi|child|develop)/, emoji: "👶" },
  { test: /(repro|obgyn|obstet|preg|gyne)/, emoji: "🤰" },
  { test: /(infect|micro|virus)/, emoji: "🦠" },
] as const;

const systemEmoji = (system: string) =>
  SYSTEM_EMOJI.find(({ test }) => test.test(system.toLowerCase()))?.emoji ??
  "🩺";

/** Yield tier drives emphasis — the curriculum already ranks its own topics. */
const TIER_LABEL: Record<string, string> = {
  high: "High yield",
  medium: "Core",
  low: "Extra",
};

/** Progress reads as a glyph rather than a coloured dot — same three states. */
const STATE_STYLE: Record<TopicState, { emoji: string; label: string }> = {
  drilled: { emoji: "✅", label: "Deck built" },
  studied: { emoji: "📝", label: "Sheet saved" },
  untouched: { emoji: "⚪", label: "Not started" },
};

const Roadmap = () => {
  const navigate = useNavigate();
  const [activeSystem, setActiveSystem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const topicsQuery = useQuery({
    queryKey: ["curriculum-topics"],
    queryFn: async (): Promise<CurriculumTopic[]> => {
      const { data, error } = await supabase
        .from("curriculum_topics")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const sections = useMemo(
    () => groupBySystem(topicsQuery.data ?? []),
    [topicsQuery.data]
  );

  const allTitles = useMemo(
    () => sections.flatMap((s) => s.topics.map((t) => t.title)),
    [sections]
  );
  const progress = useCurriculumProgress(allTitles);

  // Select the first system once the data lands, so the detail pane is never
  // an empty frame waiting on a click.
  useEffect(() => {
    if (!activeSystem && sections.length) setActiveSystem(sections[0].system);
  }, [sections, activeSystem]);

  const covered = useMemo(
    () =>
      allTitles.filter((t) => progress.get(t)?.state !== "untouched").length,
    [allTitles, progress]
  );

  /** Coverage for one system, used by the rail's progress bars. */
  const systemCoverage = (section: SystemSection) => {
    const done = section.topics.filter(
      (t) => progress.get(t.title)?.state !== "untouched"
    ).length;
    return { done, total: section.topics.length };
  };

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (!searching) return [];
    const q = query.toLowerCase();
    return sections
      .flatMap((s) => s.topics.map((t) => ({ topic: t, system: s.system })))
      .filter(({ topic }) => topic.title.toLowerCase().includes(q))
      .slice(0, 40);
  }, [query, sections, searching]);

  const activeSection = sections.find((s) => s.system === activeSystem) ?? null;

  const openSheet = (title: string) =>
    navigate("/sheets", { state: { topic: title } });

  return (
    <DashboardLayout wide>
      <main className="dashboard-main">
        <div className="dashboard-container mx-auto w-full max-w-[min(1200px,calc(100%-1rem))]">
          {/* Header Roadmap */}
          <section className="mb-5 sm:mb-6 md:mb-8 rounded-[var(--r-lg)] border border-border bg-card p-4 sm:p-5 lg:p-6 shadow-sm ring-1 ring-primary/5">
            <div className="flex flex-col gap-4 sm:gap-5 md:flex-row md:items-end md:justify-between lg:gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-[60ch] w-full">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-primary font-mono shadow-sm">
                  <Stethoscope className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  Curriculum
                </div>
                <h1 className="mt-2 sm:mt-3 text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-[#0aafa9]">
                  Roadmap
                </h1>
                <p className="mt-2 sm:mt-2.5 max-w-[52ch] text-sm sm:text-base text-muted-foreground">
                  Every high-yield topic, grouped by body system and tied to the
                  study flow you already use across sheets, decks, and QBank.
                </p>
              </div>

              <div className="grid w-full max-w-xl grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-[var(--r-md)] border border-border bg-background/80 p-2.5 sm:p-3 shadow-sm">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-mono">
                    <BookOpenCheck className="h-3 w-3 sm:h-4 sm:w-4 text-[#0aafa9]" />
                    Covered
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-semibold text-foreground">
                    {covered}
                  </div>
                </div>
                <div className="rounded-[var(--r-md)] border border-border bg-background/80 p-2.5 sm:p-3 shadow-sm">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-mono">
                    <Layers className="h-3 w-3 sm:h-4 sm:w-4 text-[#0aafa9]" />
                    Systems
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-semibold text-foreground">
                    {sections.length}
                  </div>
                </div>
                <div className="rounded-[var(--r-md)] border border-border bg-background/80 p-2.5 sm:p-3 shadow-sm">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-mono">
                    <Sparkles className="h-3 w-3 sm:h-4 sm:w-4 text-[#0aafa9]" />
                    Focus
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-[10px] sm:text-sm font-medium text-foreground">
                    High yield
                  </div>
                </div>
              </div>
            </div>
          </section>
          {/* footer Roadmap */}
          {topicsQuery.isLoading ? (
            <PageLoader context="sheets" />
          ) : topicsQuery.isError ? (
            <div className="ds-card text-center">
              <p className="ds-body font-medium text-foreground">
                Couldn't load the roadmap
              </p>
              <p className="ds-small mt-1">Check your connection and try again.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => topicsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : sections.length === 0 ? (
            <div className="ds-card py-12 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[var(--r-md)] bg-primary/10">
                <Compass className="h-5 w-5 text-[#0aafa9]" />
              </div>
              <p className="ds-body mt-4 font-medium text-foreground">
                Curriculum loading soon
              </p>
              <p className="ds-small mx-auto mt-1 max-w-[42ch]">
                High-yield topics are on their way. Meanwhile you can generate a
                sheet on any topic you like.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 sm:mb-6 rounded-[var(--r-lg)] border border-border bg-card p-3 sm:p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-baseline gap-2 sm:gap-2.5">
                    <span className="text-2xl sm:text-[28px] font-semibold leading-none text-foreground">
                      {covered}
                    </span>
                    <span className="ds-small text-xs sm:text-sm">
                      of {allTitles.length} topics covered
                      <span className="mx-1.5 opacity-40">·</span>
                      {sections.length} systems
                    </span>
                  </div>

                  <div className="relative w-full sm:max-w-sm md:max-w-xs">
                    <Search className="text-[#0aafa9] absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search all topics…"
                      aria-label="Search all curriculum topics"
                      className="h-10 sm:h-11 w-full rounded-[var(--r-md)] border border-border bg-background ps-9 pe-9 text-[13px] sm:text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                    />
                    {searching && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-[var(--r-sm)] p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {searching ? (
                <section aria-label="Search results">
                  
                  {results.length === 0 ? (
                    <div className="rounded-[var(--r-lg)] border border-dashed border-border bg-card p-4 sm:p-6 text-xs sm:text-sm text-muted-foreground">
                      No topic matches "{query}". You can still generate a sheet on it —{" "}
                      <button
                        type="button"
                        onClick={() => openSheet(query.trim())}
                        className="text-primary underline underline-offset-2"
                      >
                        try it anyway
                      </button>
                      .
                    </div>
                  ) : (
                    <ul className="list-none space-y-2 sm:space-y-3 p-0">
                      {results.map(({ topic, system }) => (
                        <TopicRow
                          key={topic.id}
                          title={topic.title}
                          tier={topic.yield_tier}
                          system={system}
                          progress={progress.get(topic.title)}
                          onOpen={() => openSheet(topic.title)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <>
                  {/* Mobile sidebar toggle button */}
                  <div className="mb-4 flex items-center gap-2 md:hidden">
                    <button
                      type="button"
                      onClick={() => setMobileSidebarOpen(true)}
                      className="flex items-center w-full gap-2 px-3 py-2 rounded-[var(--r-md)] border border-border bg-background hover:bg-secondary/50 transition-colors"
                    >
                      <Layers className="h-4 w-4 text-[#0aafa9]" />
                      <span className="text-sm font-medium text-foreground">Systems</span>
                    </button>
                  </div>

                  {/* Mobile sidebar overlay */}
                  {mobileSidebarOpen && (
                    <div
                      className="fixed inset-0 bg-black/50 z-50 md:hidden"
                      onClick={() => setMobileSidebarOpen(false)}
                    />
                  )}

                  {/* Mobile sidebar */}
                  <div
                    className={`fixed inset-y-0 right-0 z-50 w-72 max-w-[75vw] bg-background border-l border-border shadow-2xl md:hidden transform transition-transform duration-300 ease-in-out ${
                      mobileSidebarOpen ? "translate-x-0" : "translate-x-full"
                    }`}
                  >
                    <div className="flex items-center justify-between p-4 border-b border-border">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-[#0aafa9]" />
                        <p className="ds-label text-base sm:text-lg">Systems</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(false)}
                        className="p-2 rounded-[var(--r-sm)] hover:bg-secondary/50 transition-colors"
                      >
                        <X className="h-5 w-5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="p-4 overflow-y-auto h-full pb-20">
                      <ul className="list-none space-y-2 p-0">
                        {sections.map((section) => {
                          const { done, total } = systemCoverage(section);
                          const active = section.system === activeSystem;
                          return (
                            <li key={section.system}>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSystem(section.system);
                                  setMobileSidebarOpen(false);
                                }}
                                aria-current={active ? "true" : undefined}
                                className={`flex w-full items-center gap-3 rounded-[var(--r-md)] border px-3 py-2.5 text-start transition-all ${
                                  active
                                    ? " shadow-sm border-[#0aafa9] bg-[#0aafa9]/5"
                                    : " bg-background/60 hover:border-border hover:bg-secondary/40"
                                }`}
                              >
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-base leading-none ${
                                    active ? "bg-[#0aafa9]/30" : "bg-secondary"
                                  }`}
                                  aria-hidden="true"
                                >
                                  {systemEmoji(section.system)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[14px] font-medium text-foreground">
                                    {section.system}
                                  </span>
                                  <span className="ds-meta ds-num mt-0.5 block text-sm">
                                    {done}/{total}
                                  </span>
                                </span>
                                <span
                                  className="h-8 w-1.5 shrink-0 overflow-hidden rounded-full bg-border"
                                  aria-hidden="true"
                                >
                                  <span
                                    className="block w-full rounded-full bg-primary transition-all"
                                    style={{
                                      height: `${total ? (done / total) * 100 : 0}%`,
                                      marginTop: `${total ? 100 - (done / total) * 100 : 100}%`,
                                    }}
                                  />
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:gap-5 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
                    {/* Desktop sidebar */}
                    <nav aria-label="Body systems" className="hidden md:block md:sticky md:top-6 md:self-start">
                      <div className="mb-2 sm:mb-3 flex items-center gap-2">
                        <Layers className="h-4 w-4 text-[#0aafa9]" />
                        <p className="ds-label text-base sm:text-lg">Systems</p>
                      </div>
                      <ul className="list-none space-y-1.5 sm:space-y-2 p-0">
                        {sections.map((section) => {
                          const { done, total } = systemCoverage(section);
                          const active = section.system === activeSystem;
                          return (
                            <li key={section.system}>
                              <button
                                type="button"
                                onClick={() => setActiveSystem(section.system)}
                                aria-current={active ? "true" : undefined}
                                className={`flex w-full items-center gap-2.5 sm:gap-3 rounded-[var(--r-md)] border px-2.5 sm:px-3 py-2 sm:py-2.5 text-start transition-all ${
                                  active
                                    ? " shadow-sm border-[#0aafa9] bg-[#0aafa9]/5"
                                    : " bg-background/60 hover:border-border hover:bg-secondary/40"
                                }`}
                              >
                                <span
                                  className={`flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-sm sm:text-base leading-none ${
                                    active ? "bg-[#0aafa9]/30" : "bg-secondary"
                                  }`}
                                  aria-hidden="true"
                                >
                                  {systemEmoji(section.system)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] sm:text-[14px] font-medium text-foreground">
                                    {section.system}
                                  </span>
                                  <span className="ds-meta ds-num mt-0.5 block text-xs sm:text-sm">
                                    {done}/{total}
                                  </span>
                                </span>
                                <span
                                  className="h-7 sm:h-8 w-1.5 shrink-0 overflow-hidden rounded-full bg-border"
                                  aria-hidden="true"
                                >
                                  <span
                                    className="block w-full rounded-full bg-primary transition-all"
                                    style={{
                                      height: `${total ? (done / total) * 100 : 0}%`,
                                      marginTop: `${total ? 100 - (done / total) * 100 : 100}%`,
                                    }}
                                  />
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </nav>

                    <section aria-label={`Topics in ${activeSection?.system ?? ""}`}>
                      {activeSection && (
                        <div className="rounded-[var(--r-lg)] border border-border bg-card p-4 sm:p-5 lg:p-6 shadow-sm">
                          <div className="mb-4 sm:mb-5 flex flex-col gap-2.5 sm:gap-3 border-b border-border pb-3 sm:pb-4 md:flex-row md:items-end md:justify-between">
                            <div>
                              <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                                <span aria-hidden="true">{systemEmoji(activeSection.system)}</span>
                                System focus
                              </div>
                              <h2 className="ds-title mt-2 sm:mt-3 text-lg sm:text-xl">{activeSection.system}</h2>
                              <p className="ds-meta mt-0.5 sm:mt-1 text-xs sm:text-sm">
                                {systemCoverage(activeSection).done} of {activeSection.topics.length} covered
                              </p>
                            </div>
                            <div className="rounded-[var(--r-md)] border border-border bg-background px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-foreground">
                              {activeSection.topics.length} topics
                            </div>
                          </div>

                          <ul className="list-none space-y-2 sm:space-y-3 p-0">
                            {activeSection.topics.map((topic) => (
                              <TopicRow
                                key={topic.id}
                                title={topic.title}
                                tier={topic.yield_tier}
                                progress={progress.get(topic.title)}
                                onOpen={() => openSheet(topic.title)}
                              />
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
};

/**
 * One topic. A row, not a card — a curriculum is a list, and forty cards in a
 * grid is harder to scan than forty lines.
 */
const TopicRow = ({
  title,
  tier,
  system,
  progress,
  onOpen,
}: {
  title: string;
  tier: string | null;
  system?: string;
  progress?: { state: TopicState; cards: number };
  onOpen: () => void;
}) => {
  const state = progress?.state ?? "untouched";
  const style = STATE_STYLE[state];

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-2 sm:gap-2.5 rounded-[var(--r-md)] border border-border bg-[hsl(var(--card))] px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-start transition-all hover:border-primary/40 hover:bg-[hsl(var(--secondary))]/50 hover:shadow-sm"
      >
        <span
          className="flex h-7 w-7 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-secondary text-xs sm:text-sm leading-none text-foreground"
          aria-hidden="true"
        >
          {style.emoji}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] sm:text-[14px] font-medium text-foreground">
            {title}
          </span>
          <span className="ds-meta mt-0.5 flex flex-wrap items-center gap-x-2 text-xs sm:text-sm">
            {system && (
              <span>
                <span aria-hidden="true">{systemEmoji(system)} </span>
                {system}
              </span>
            )}
            {system && <span className="opacity-40">·</span>}
            <span>{style.label}</span>
            {!!progress?.cards && (
              <>
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                  {progress.cards}
                </span>
              </>
            )}
          </span>
        </span>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {tier === "high" && (
            <span className="shrink-0 rounded-full border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning-soft))] px-1.5 sm:px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--warning))]">
              <span aria-hidden="true">🔥 </span>
              {TIER_LABEL.high}
            </span>
          )}

          <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
      </button>
    </li>
  );
};

export default Roadmap;
