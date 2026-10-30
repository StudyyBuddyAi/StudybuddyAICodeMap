import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CurriculumTopic } from "@/lib/qbank-suggestions";
import {
  FAMILY_TOPICS,
  SYSTEM_KEYS,
  SYSTEM_NAMES,
  isFamily,
  type SystemKey,
} from "../../../supabase/functions/_shared/qbank-systems.ts";

/**
 * UWorld's system picker without the cold start: every system (and the two
 * families), opened to show its topics as checkboxes, with "All of …" for a
 * whole-system mix. Adds at most `slots` topics — the composer's room left.
 */
const SystemBrowser = ({
  open,
  onOpenChange,
  curriculum,
  slots,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  curriculum: CurriculumTopic[];
  slots: number;
  onAdd: (topics: string[]) => void;
}) => {
  const [expanded, setExpanded] = useState<SystemKey | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const topicsFor = useMemo(() => {
    const map = new Map<SystemKey, string[]>();
    for (const k of SYSTEM_KEYS) {
      map.set(
        k,
        isFamily(k)
          ? FAMILY_TOPICS[k]
          : curriculum
              .filter((c) => c.system === k)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => c.title)
      );
    }
    return map;
  }, [curriculum]);

  const toggle = (title: string) =>
    setPicked((p) => (p.includes(title) ? p.filter((x) => x !== title) : p.length < slots ? [...p, title] : p));

  const close = (o: boolean) => {
    if (!o) {
      setPicked([]);
      setExpanded(null);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] max-w-lg gap-4 overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 text-left">
          <DialogTitle>Browse by system</DialogTitle>
          <DialogDescription className="text-[13px]">
            Pick topics to mix, or a whole system. Room for {slots} more.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto px-5">
          <ul className="grid gap-1.5">
            {SYSTEM_KEYS.map((k) => {
              const name = SYSTEM_NAMES[k];
              const list = topicsFor.get(k) ?? [];
              const isOpen = expanded === k;
              const chosenHere = picked.filter((p) => p === name || list.includes(p)).length;
              return (
                <li key={k} className="rounded-xl border border-border">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : k)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {chosenHere > 0 && (
                      <span className="rounded-full bg-primary px-2 text-[11px] font-semibold text-primary-foreground">
                        {chosenHere}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{list.length}</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="grid gap-0.5 border-t border-border px-2 py-2">
                      {[{ title: name, label: `All of ${name} (mixed)` }, ...list.map((t) => ({ title: t, label: t }))].map(
                        ({ title, label }) => {
                          const on = picked.includes(title);
                          const blocked = !on && picked.length >= slots;
                          return (
                            <button
                              key={title + label}
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              disabled={blocked}
                              onClick={() => toggle(title)}
                              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-secondary disabled:opacity-40"
                            >
                              <span
                                className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                                  on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                                }`}
                              >
                                {on && <Check className="h-3 w-3" strokeWidth={3} />}
                              </span>
                              <span className={title === name ? "font-medium text-foreground" : "text-foreground"}>{label}</span>
                            </button>
                          );
                        }
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="h-10 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={picked.length === 0}
            onClick={() => {
              onAdd(picked);
              close(false);
            }}
            className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {picked.length > 0 ? `Add ${picked.length} topic${picked.length === 1 ? "" : "s"}` : "Add topics"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SystemBrowser;
