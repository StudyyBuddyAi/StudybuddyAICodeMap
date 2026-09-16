import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { LAB_TABS, searchLabValues, type LabValue } from "@/lib/lab-values";

const LabRow = ({ value }: { value: LabValue }) => (
  <div
    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2"
    style={{ borderBottom: "1px solid var(--border)" }}
  >
    <div className="min-w-0">
      <p className="text-[13px] leading-snug" style={{ color: "var(--fg)" }}>
        {value.name}
      </p>
      {value.note && (
        <p className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
          {value.note}
        </p>
      )}
    </div>
    <div className="text-right">
      <p className="tabular-nums text-[13px]" style={{ color: "var(--fg)" }}>
        {value.conventional}
      </p>
      {value.si && (
        <p className="tabular-nums text-[11px]" style={{ color: "var(--fg-muted)" }}>
          {value.si}
        </p>
      )}
    </div>
  </div>
);

/**
 * The reference ranges a vignette is written against.
 *
 * Non-modal: on the exam the lab panel sits beside the question, and a student
 * reading a potassium off it needs the stem still in view and still clickable.
 */
const LabValuesSheet = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchLabValues(query), [query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "flex h-[75vh] flex-col gap-3 p-4"
            : "flex w-full flex-col gap-3 p-5 sm:max-w-md"
        }
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="text-left">
          <SheetTitle>Lab values</SheetTitle>
          <SheetDescription>Typical adult reference ranges. Ranges vary between laboratories.</SheetDescription>
        </SheetHeader>

        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "var(--fg-subtle)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — sodium, TSH, CSF glucose…"
            aria-label="Search lab values"
            className="h-9 w-full rounded-md border pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)]"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--fg)" }}
          />
        </label>

        {query.trim() ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {results.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: "var(--fg-muted)" }}>
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              results.map(({ tab, group, value }, i) => (
                <div key={`${tab.id}-${group.heading}-${value.name}-${value.note ?? ""}-${i}`}>
                  <p className="pt-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
                    {tab.label} · {group.heading}
                  </p>
                  <LabRow value={value} />
                </div>
              ))
            )}
          </div>
        ) : (
          <Tabs defaultValue="serum" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="h-auto w-full flex-wrap justify-start">
              {LAB_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {LAB_TABS.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="mt-2 min-h-0 flex-1 overflow-y-auto">
                {tab.groups.map((group) => (
                  <section key={group.heading} className="mb-4">
                    <p
                      className="mb-1 text-[10px] font-medium uppercase tracking-wider"
                      style={{ color: "var(--accent)" }}
                    >
                      {group.heading}
                    </p>
                    {group.values.map((value, i) => (
                      <LabRow key={`${value.name}-${value.note ?? ""}-${i}`} value={value} />
                    ))}
                  </section>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default LabValuesSheet;
