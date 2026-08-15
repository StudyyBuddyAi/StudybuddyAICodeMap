import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import TpiceRodmap from "@/models/TpiceRodmap";
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

const getSectionAppearance = (system: string, index: number) => {
  const normalized = system.toLowerCase();
  const tone = index % 2 === 0 ? "blue" : "green";

  const iconMap = [
    { test: /(cardio|heart)/, icon: FaHeartPulse },
    { test: /(musculo|skin|bone)/, icon: FaBone },
    { test: /(hemat|onc|blood)/, icon: FaDroplet },
    { test: /(psych|brain|neuro)/, icon: FaBrain },
    { test: /(resp|lung)/, icon: FaLungs },
    { test: /(pedi|child)/, icon: FaShieldHeart },
    { test: /(endo|horm|thyroid)/, icon: FaCapsules },
    { test: /(gastro|digest|intestinal)/, icon: FaStethoscope },
    { test: /(repro|obgyn|preg|gyne)/, icon: FaShieldHeart },
    { test: /(infect|micro|virus)/, icon: FaShieldHeart },
    { test: /(renal|urinary|kidney)/, icon: FaDroplet },
  ] as const;

  const match = iconMap.find(({ test }) => test.test(normalized));

  return {
    tone,
    Icon: match?.icon ?? (tone === "blue" ? FaHeartPulse : FaStethoscope),
  };
};

const Roadmap = () => {
  const navigate = useNavigate();
  const [selectedSection, setSelectedSection] = useState<SystemSection | null>(null);

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
  const topicCount = sections.reduce((n, s) => n + s.topics.length, 0);

  // "18 high-yield cardiovascular topics" while only one system ships; drops
  // the system name once there are several.
  const countLabel =
    sections.length === 1
      ? `${topicCount} high-yield ${sections[0].system.toLowerCase()} topics`
      : `${topicCount} high-yield topics across ${sections.length} systems`;

  const openSheetFor = (title: string) => {
    navigate("/sheets", { state: { topic: title } });
  };

  return (
    <DashboardLayout>
      <div className="max-w-[100%] space-y-6 px-4 py-6 sm:px-8 lg:px-12">
        <div className="space-y-1">
          <h1 className="text-3xl py-2 font-semibold text-primary tracking-tight">
            Roadmap
          </h1>
          <p className="text-sm text-muted-foreground">
            High-yield topics organized by system. Tap any topic to generate a
            study sheet.
          </p>
        </div>

        {topicsQuery.isLoading ? (
          <PageLoader context="sheets" />
        ) : topicsQuery.isError ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center space-y-3">
            <p className="text-sm font-medium text-foreground">
              Couldn't load the roadmap
            </p>
            <p className="text-xs text-muted-foreground">
              Check your connection and try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => topicsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : sections.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center space-y-2">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Compass className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">
              Curriculum loading soon
            </p>
            <p className="text-xs text-muted-foreground">
              High-yield topics are on their way. In the meantime, you can
              generate a sheet on any topic you like.
            </p>
          </div>
        ) : (
          <>
            <div className="inline-flex items-center gap-3 rounded-full border border-primary/30 bg-card px-4 py-2.5 ring-1 ring-primary/10">
              <div className="flex h-6 w-6 items-center justify-center rounded-[10px] border border-primary/20 bg-primary/10 text-primary">
                <Compass className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary sm:text-xs">
                {countLabel}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {sections.map((section, index) => {
                const { tone, Icon } = getSectionAppearance(section.system, index);
                const isBlue = tone === "blue";

                return (
                  <button
                    type="button"
                    onClick={() => setSelectedSection(section)}
                    key={section.system}
                    className="group min-h-[170px] w-full cursor-pointer rounded-[24px] border border-border bg-card p-5 text-left transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Two tones alternate purely by index for visual rhythm —
                          they carry no meaning, so any two theme tokens work. */}
                      <div
                        className={`flex h-16 w-16 items-center justify-center rounded-[18px] ${
                          isBlue
                            ? "bg-primary/10 text-primary"
                            : "bg-success-soft text-success"
                        }`}
                      >
                        <Icon className="h-7 w-7" />
                      </div>

                      <span
                        className={`inline-flex items-center rounded-full px-4 py-2 text-base font-semibold ${
                          isBlue
                            ? "bg-primary/10 text-primary"
                            : "bg-success-soft text-success"
                        }`}
                      >
                        {section.topics.length} Topics
                      </span>
                    </div>

                    <h3 className="mt-8 text-left text-[1.2rem] font-medium leading-none tracking-[-0.04em] text-foreground">
                      {section.system}
                    </h3>
                  </button>
                );
              })}
            </div>

            <Dialog open={selectedSection !== null} onOpenChange={() => setSelectedSection(null)}>
              <DialogContent className="max-h-[86vh] max-w-[1160px] overflow-y-auto border-0 bg-transparent p-0 shadow-none">
                {selectedSection && (
                  <TpiceRodmap
                    section={selectedSection}
                    onClose={() => setSelectedSection(null)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Roadmap;
