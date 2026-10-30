import { useId, useMemo, useRef, useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import { didYouMean, exactOption, suggestTopics, type TopicOption } from "@/lib/topic-suggest";
import { topicRejectionMessage, validateTopic } from "@/lib/validate-topic";

/**
 * What the student wants to practise: one topic, or up to `max` mixed together.
 *
 * Typing then Enter or a comma makes a chip; pasting "a, b; c" makes three.
 * Suggestions come from the student's own topics, the curriculum and whole
 * systems, matched forgivingly (see topic-suggest.ts); free text is always
 * allowed. The half-typed text is the parent's (`draft`), so Start can include
 * it without the student pressing Enter first.
 */
const TopicComposer = ({
  topics,
  onChange,
  draft,
  onDraftChange,
  options,
  max,
  disabled,
  onSubmit,
  onBrowse,
}: {
  topics: string[];
  onChange: (topics: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  options: TopicOption[];
  max: number;
  disabled?: boolean;
  /** Enter on an empty input with at least one topic: start the set. */
  onSubmit: () => void;
  onBrowse: () => void;
}) => {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const full = topics.length >= max;
  const suggestions = useMemo(
    () => (draft.trim() ? suggestTopics(draft, options, { exclude: topics, limit: 6 }) : []),
    [draft, options, topics]
  );
  // Shown whenever only a typo would match — the list may hold the same
  // option, but a student reading "pediatrcs" back deserves to be told.
  const fix = useMemo(() => (draft.trim() ? didYouMean(draft, options) : null), [draft, options]);
  const showList = open && suggestions.length > 0 && !full;

  /** Adds topics, skipping duplicates and junk; true when anything was added. */
  const add = (raw: string[]): boolean => {
    const next = [...topics];
    for (const value of raw) {
      const topic = value.trim().slice(0, 300);
      if (!topic) continue;
      if (next.length >= max) {
        setError(`Up to ${max} topics in one set.`);
        break;
      }
      const rejection = validateTopic(topic);
      if (rejection) {
        setError(topicRejectionMessage(rejection));
        continue;
      }
      if (next.some((t) => t.toLowerCase() === topic.toLowerCase())) continue;
      next.push(topic);
    }
    if (next.length === topics.length) return false;
    onChange(next);
    onDraftChange("");
    setActive(0);
    return true;
  };

  const remove = (index: number) => {
    onChange(topics.filter((_, i) => i !== index));
    setError(null);
    inputRef.current?.focus();
  };

  const systemOf = (topic: string) => exactOption(topic, options)?.systemName ?? null;

  return (
    <div className="relative">
      <div
        className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-[14px] border px-2 py-1.5 transition-colors focus-within:border-[var(--color-accent)]"
        style={{ borderColor: error ? "var(--color-danger, #dc2626)" : "var(--color-border)", background: "var(--color-background)" }}
        onClick={() => inputRef.current?.focus()}
      >
        {topics.map((t, i) => {
          const system = systemOf(t);
          return (
            <span
              key={t}
              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-[color:var(--color-card)] pl-3 pr-1 text-sm text-foreground"
            >
              <span className="truncate">{t}</span>
              {system && system !== t && (
                <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{system}</span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                disabled={disabled}
                aria-label={`Remove ${t}`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-label="Topics to practise"
          value={draft}
          disabled={disabled || full}
          onChange={(e) => {
            onDraftChange(e.target.value);
            setOpen(true);
            setActive(0);
            if (error) setError(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,;\n]/.test(text)) {
              e.preventDefault();
              add(text.split(/[,;\n]+/));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && showList) {
              e.preventDefault();
              setActive((a) => (a + 1) % suggestions.length);
            } else if (e.key === "ArrowUp" && showList) {
              e.preventDefault();
              setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (showList && suggestions[active]) add([suggestions[active].title]);
              else if (draft.trim()) add([draft]);
              else if (topics.length > 0) onSubmit();
            } else if (e.key === "," || (e.key === "Tab" && showList && draft.trim())) {
              if (!draft.trim()) return;
              e.preventDefault();
              add([showList && e.key === "Tab" ? suggestions[active].title : draft]);
            } else if (e.key === "Backspace" && !draft && topics.length > 0) {
              remove(topics.length - 1);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={
            full
              ? `Up to ${max} topics`
              : topics.length === 0
                ? "Type a topic — heart failure, DKA, breaking bad news…"
                : "Add another to mix them"
          }
          className="h-9 min-w-[10rem] flex-1 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-[14px] border border-border bg-[color:var(--color-card)] py-1 shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.source}-${s.title}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add([s.title]);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-secondary" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {s.source === "system" ? `All of ${s.title}` : s.title}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {s.source === "library" ? "Your topic" : s.source === "system" ? "Mixed system" : s.systemName}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled || full}
          className="inline-flex items-center gap-1.5 font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Browse by system
        </button>
        {fix && (
          <span className="text-muted-foreground">
            Did you mean{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-4"
              onClick={() => add([fix.title])}
            >
              {fix.source === "system" ? `all of ${fix.title}` : fix.title}
            </button>
            ?
          </span>
        )}
        {error && (
          <span role="alert" className="text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
};

export default TopicComposer;
