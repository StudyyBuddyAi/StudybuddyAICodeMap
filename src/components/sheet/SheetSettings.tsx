import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { PoweredByCorti } from "@/components/PoweredByCorti";
import type { ModelPreference } from "@/hooks/use-model-preference";

/**
 * The sheet's settings as a row of chips, each opening onto its choices.
 *
 * They used to be a "Customize" card of pill groups beside the document, taking
 * a third of the page for the whole session. As chips they sit where the choice
 * is made, say what they are set to at a glance, and take no room while
 * reading. The same row serves the composer and the topic bar's Edit panel, so
 * a setting looks and behaves the same wherever it is changed.
 */

interface Choice<T extends string = string> {
  value: T;
  label: string;
  hint: string;
}

// The hints say what a setting changes, and no more: exam mode and difficulty
// decide which sections a topic gets, and which ones depends on the topic.
const EXAM_CHOICES: Choice[] = [
  { value: "General", label: "General", hint: "The topic's core sections" },
  { value: "USMLE Step 1", label: "Step 1", hint: "Basic-science focus" },
  { value: "USMLE Step 2", label: "Step 2", hint: "Clinical focus" },
];

const DIFFICULTY_CHOICES: Choice[] = [
  { value: "Basic", label: "Basic", hint: "Foundations, plainly put" },
  { value: "Intermediate", label: "Intermediate", hint: "Exam-level depth" },
  { value: "Advanced", label: "Advanced", hint: "Adds a deeper section" },
];

const LENGTH_CHOICES: Choice[] = [
  { value: "Concise", label: "Concise", hint: "The essentials" },
  { value: "Moderate", label: "Moderate", hint: "More in each section" },
  { value: "Detailed", label: "Detailed", hint: "Everything worth knowing" },
];

const SOURCE_CHOICES: Choice<"on" | "off">[] = [
  { value: "on", label: "Guideline library", hint: "Built on retrieved passages, cited" },
  { value: "off", label: "Model knowledge only", hint: "No retrieval, no sources" },
];

const MODEL_CHOICES: Choice<ModelPreference>[] = [
  { value: "corti", label: "Corti S1", hint: "Best quality" },
  { value: "gpt-oss", label: "GPT-OSS 20B", hint: "Fastest" },
];

const labelOf = (choices: Choice[], value: string) =>
  choices.find((c) => c.value === value)?.label ?? value;

// ── One chip ────────────────────────────────────────────────────────────────

interface SettingChipProps {
  /** What the setting is, for the popover's heading and the chip's label. */
  name: string;
  /** What it is set to, shown on the chip. */
  value: string;
  disabled?: boolean;
  width?: number;
  children: (close: () => void) => ReactNode;
}

function SettingChip({ name, value, disabled, width = 256, children }: SettingChipProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${name}: ${value}`}
          className="group inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors duration-200 hover:border-primary/50 disabled:cursor-default disabled:opacity-50 data-[state=open]:border-primary data-[state=open]:bg-secondary"
        >
          {value}
          <ChevronDown
            aria-hidden
            className="h-3 w-3 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="p-1.5" style={{ width }}>
        <p className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {name}
        </p>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

function ChoiceList<T extends string>({
  name,
  choices,
  value,
  onPick,
}: {
  name: string;
  choices: Choice<T>[];
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name}>
      {choices.map((c) => {
        const checked = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onPick(c.value)}
            className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary focus-visible:bg-secondary"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{c.label}</span>
              <span className="block text-xs text-muted-foreground">{c.hint}</span>
            </span>
            <Check
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 text-primary transition-opacity duration-150 ${checked ? "opacity-100" : "opacity-0"}`}
            />
          </button>
        );
      })}
    </div>
  );
}

// ── The row ─────────────────────────────────────────────────────────────────

export interface GroundingSettings {
  on: boolean;
  /** Passages to retrieve, 1–10 (the edge function re-clamps). */
  topK: number;
  /** Minimum similarity, 0.40–0.90 (the edge function re-clamps). */
  threshold: number;
}

export interface SheetSettingsProps {
  examMode: string;
  onExamMode: (value: string) => void;
  difficulty: string;
  onDifficulty: (value: string) => void;
  length: string;
  onLength: (value: string) => void;
  grounding: GroundingSettings;
  onGrounding: (next: Partial<GroundingSettings>) => void;
  useMemory: boolean;
  onUseMemory: (value: boolean) => void;
  /** Pro only: the model that writes the sheet. */
  model?: {
    value: ModelPreference;
    onChange: (value: ModelPreference) => void;
    /** The preference is loading or being saved. */
    busy: boolean;
  };
  disabled?: boolean;
}

const SheetSettings = ({
  examMode,
  onExamMode,
  difficulty,
  onDifficulty,
  length,
  onLength,
  grounding,
  onGrounding,
  useMemory,
  onUseMemory,
  model,
  disabled,
}: SheetSettingsProps) => (
  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sheet settings">
    <SettingChip name="Exam mode" value={labelOf(EXAM_CHOICES, examMode)} disabled={disabled}>
      {(close) => (
        <ChoiceList
          name="Exam mode"
          choices={EXAM_CHOICES}
          value={examMode}
          onPick={(v) => {
            onExamMode(v);
            close();
          }}
        />
      )}
    </SettingChip>

    <SettingChip name="Difficulty" value={labelOf(DIFFICULTY_CHOICES, difficulty)} disabled={disabled}>
      {(close) => (
        <ChoiceList
          name="Difficulty"
          choices={DIFFICULTY_CHOICES}
          value={difficulty}
          onPick={(v) => {
            onDifficulty(v);
            close();
          }}
        />
      )}
    </SettingChip>

    <SettingChip name="Length" value={labelOf(LENGTH_CHOICES, length)} disabled={disabled}>
      {(close) => (
        <ChoiceList
          name="Length"
          choices={LENGTH_CHOICES}
          value={length}
          onPick={(v) => {
            onLength(v);
            close();
          }}
        />
      )}
    </SettingChip>

    {/* Sources stays open on a pick: the fine-tuning below it is the reason
        to be here as often as the switch itself. */}
    <SettingChip
      name="Sources"
      value={grounding.on ? "Sources on" : "Sources off"}
      disabled={disabled}
      width={300}
    >
      {() => (
        <>
          <ChoiceList
            name="Sources"
            choices={SOURCE_CHOICES}
            value={grounding.on ? "on" : "off"}
            onPick={(v) => onGrounding({ on: v === "on" })}
          />
          <div className="mt-1.5 space-y-4 border-t border-border px-2.5 pb-2 pt-3">
            <div className={grounding.on ? "" : "pointer-events-none opacity-50"} aria-hidden={!grounding.on}>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Passages to use</span>
                <span className="font-mono font-semibold text-primary">{grounding.topK}</span>
              </div>
              <Slider
                value={[grounding.topK]}
                onValueChange={([v]) => onGrounding({ topK: v })}
                min={1}
                max={10}
                step={1}
                disabled={!grounding.on}
                aria-label="Number of guideline passages to retrieve"
              />
              <div className="mb-2 mt-4 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Match strictness</span>
                <span className="font-mono font-semibold text-primary">
                  {Math.round(grounding.threshold * 100)}%
                </span>
              </div>
              <Slider
                value={[grounding.threshold]}
                onValueChange={([v]) => onGrounding({ threshold: v })}
                min={0.4}
                max={0.9}
                step={0.05}
                disabled={!grounding.on}
                aria-label="Minimum similarity for a guideline passage to count"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Stricter means fewer, closer passages — and more sheets written without the library.
              </p>
            </div>
            {/* Memory is independent of grounding, so it stays live when the
                sliders above are dimmed. */}
            <label className="flex cursor-pointer items-start gap-2 border-t border-border pt-3">
              <input
                type="checkbox"
                checked={useMemory}
                onChange={(e) => onUseMemory(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
              />
              <span className="text-xs leading-relaxed text-muted-foreground">
                <span className="block font-medium text-foreground">Remember my recent questions</span>
                Lets follow-ups refer back. Resets every 10 questions.
              </span>
            </label>
          </div>
        </>
      )}
    </SettingChip>

    {model && (
      <SettingChip
        name="Model"
        value={labelOf(MODEL_CHOICES, model.value)}
        disabled={disabled || model.busy}
        width={240}
      >
        {(close) => (
          <>
            <ChoiceList
              name="Model"
              choices={MODEL_CHOICES}
              value={model.value}
              onPick={(v) => {
                model.onChange(v);
                close();
              }}
            />
            {model.value === "corti" && (
              <div className="flex justify-center px-2.5 pb-1.5 pt-1">
                <PoweredByCorti compact />
              </div>
            )}
          </>
        )}
      </SettingChip>
    )}
  </div>
);

export default SheetSettings;
