import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Compass,
  Layers,
  Search,
  Sparkles,
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
import {
  FaBone,
  FaBrain,
  FaCapsules,
  FaDroplet,
  FaHeartPulse,
  FaLungs,
  FaShieldHeart,
  FaStethoscope,
} from "react-icons/fa6";

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

const ICON_FOR = [
  { test: /(cardio|heart)/, icon: FaHeartPulse },
  { test: /(musculo|skin|bone)/, icon: FaBone },
  { test: /(hemat|onc|blood)/, icon: FaDroplet },
  { test: /(psych|brain|neuro)/, icon: FaBrain },
  { test: /(resp|lung)/, icon: FaLungs },
  { test: /(endo|horm|thyroid)/, icon: FaCapsules },
  { test: /(renal|urinary|kidney)/, icon: FaDroplet },
  { test: /(pedi|child|repro|obgyn|preg|gyne|infect|micro|virus)/, icon: FaShieldHeart },
] as const;

const systemIcon = (system: string) =>
  ICON_FOR.find(({ test }) => test.test(system.toLowerCase()))?.icon ??
  FaStethoscope;

/** Yield tier drives emphasis — the curriculum already ranks its own topics. */
const TIER_LABEL: Record<string, string> = {
  high: "High yield",
  medium: "Core",
  low: "Extra",
};

const STATE_STYLE: Record<TopicState, { dot: string; label: string }> = {
  drilled: { dot: "bg-success", label: "Deck built" },
  studied: { dot: "bg-primary", label: "Sheet saved" },
  untouched: { dot: "bg-border", label: "Not started" },
};

const Roadmap = () => {
  const navigate = useNavigate();
  const [activeSystem, setActiveSystem] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
    <DashboardLayout width="app">
      <div className="ds-stack">
        <header>
          <p className="ds-label ds-label-accent">Curriculum</p>
          <h1 className="ds-display mt-2">Roadmap</h1>
          <p className="ds-subtitle mt-2.5 max-w-[54ch]">
            Every high-yield topic, by system — and which ones you've already
            covered.
          </p>
        </header>

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
              <Compass className="h-5 w-5 text-primary" />
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
            {/* ── Coverage summary + search ─────────────────────────────── */}
            <div className="flex flex-col gap-4 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-baseline gap-2.5">
                <span className="text-[26px] font-semibold leading-none text-foreground">
                  {covered}
                </span>
                <span className="ds-small">
                  of {allTitles.length} topics covered
                  <span className="mx-1.5 opacity-40">·</span>
                  {sections.length} systems
                </span>
              </div>

              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search all topics…"
                  aria-label="Search all curriculum topics"
                  className="h-10 w-full rounded-[var(--r-md)] border border-border bg-card ps-9 pe-9 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
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

            {searching ? (
              /* ── Search results, flat across every system ─────────────── */
              <section aria-label="Search results">
                <p className="ds-label mb-3">
                  {results.length} {results.length === 1 ? "match" : "matches"}
                </p>
                {results.length === 0 ? (
                  <p className="ds-small">
                    No topic matches “{query}”. You can still generate a sheet on
                    it —{" "}
                    <button
                      type="button"
                      onClick={() => openSheet(query.trim())}
                      className="text-primary underline underline-offset-2"
                    >
                      try it anyway
                    </button>
                    .
                  </p>
                ) : (
                  <ul className="ds-stack-sm list-none p-0">
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
              /* ── Master / detail. The modal this replaces was a dead end:
                   you could not compare two systems, and closing it lost your
                   place. ─────────────────────────────────────────────────── */
              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <nav aria-label="Body systems" className="lg:sticky lg:top-6 lg:self-start">
                  <p className="ds-label mb-2.5">Systems</p>
                  <ul className="list-none space-y-1 p-0">
                    {sections.map((section) => {
                      const { done, total } = systemCoverage(section);
                      const Icon = systemIcon(section.system);
                      const active = section.system === activeSystem;
                      return (
                        <li key={section.system}>
                          <button
                            type="button"
                            onClick={() => setActiveSystem(section.system)}
                            aria-current={active ? "true" : undefined}
                            className={`flex w-full items-center gap-3 rounded-[var(--r-md)] border px-3 py-2.5 text-start transition-colors ${
                              active
                                ? "border-primary/40 bg-primary/5"
                                : "border-transparent hover:bg-secondary"
                            }`}
                          >
                            <Icon
                              className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-[14px] ${active ? "font-medium text-foreground" : "text-foreground"}`}
                              >
                                {section.system}
                              </span>
                              <span className="ds-meta ds-num mt-0.5 block">
                                {done}/{total}
                              </span>
                            </span>
                            {/* Coverage, at a glance, without a number to read */}
                            <span
                              className="h-8 w-1 shrink-0 overflow-hidden rounded-full bg-border"
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
                    <>
                      <div className="mb-3 flex items-end justify-between gap-4">
                        <div>
                          <h2 className="ds-title">{activeSection.system}</h2>
                          <p className="ds-meta mt-1">
                            {systemCoverage(activeSection).done} of{" "}
                            {activeSection.topics.length} covered
                          </p>
                        </div>
                      </div>

                      <ul className="ds-stack-sm list-none p-0">
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
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
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
        className="group flex w-full items-center gap-3 rounded-[var(--r-md)] border border-border bg-card px-3.5 py-3 text-start transition-colors hover:border-primary/40"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-foreground">
            {title}
          </span>
          <span className="ds-meta mt-0.5 flex flex-wrap items-center gap-x-2">
            {system && <span>{system}</span>}
            {system && <span className="opacity-40">·</span>}
            <span>{style.label}</span>
            {!!progress?.cards && (
              <>
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {progress.cards}
                </span>
              </>
            )}
          </span>
        </span>

        {tier === "high" && (
          <span className="ds-label shrink-0 rounded-[var(--r-sm)] border border-warning/40 px-1.5 py-0.5 text-warning">
            {TIER_LABEL.high}
          </span>
        )}

        {state === "untouched" ? (
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
        ) : (
          <Check className="h-4 w-4 shrink-0 text-success" />
        )}
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </button>
    </li>
  );
};

export default Roadmap;
