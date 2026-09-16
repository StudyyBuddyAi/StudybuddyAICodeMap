import { useCallback, useState } from "react";
import { Delete } from "lucide-react";
import { evaluate, formatResult } from "@/lib/calc";

const KEYS: { label: string; value: string; kind?: "op" | "action" | "equals" }[] = [
  { label: "C", value: "clear", kind: "action" },
  { label: "(", value: "(", kind: "op" },
  { label: ")", value: ")", kind: "op" },
  { label: "÷", value: "÷", kind: "op" },
  { label: "7", value: "7" },
  { label: "8", value: "8" },
  { label: "9", value: "9" },
  { label: "×", value: "×", kind: "op" },
  { label: "4", value: "4" },
  { label: "5", value: "5" },
  { label: "6", value: "6" },
  { label: "−", value: "−", kind: "op" },
  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "+", value: "+", kind: "op" },
  { label: "%", value: "%", kind: "op" },
  { label: "0", value: "0" },
  { label: ".", value: "." },
  { label: "=", value: "equals", kind: "equals" },
];

/**
 * A plain four-function calculator for the arithmetic vignettes ask for —
 * anion gaps, BMIs, A-a gradients, NNTs. Evaluated by a small parser, never
 * eval. Takes keyboard input while focused; its keys do not reach the player,
 * so typing "4" here never selects an option.
 */
const QBankCalculator = () => {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const press = useCallback(
    (value: string) => {
      if (value === "clear") {
        setExpr("");
        setResult(null);
        return;
      }
      if (value === "back") {
        setExpr((e) => e.slice(0, -1));
        return;
      }
      if (value === "equals") {
        const n = evaluate(expr);
        if (n === null) {
          setResult("Error");
        } else {
          const formatted = formatResult(n);
          setResult(formatted);
          setExpr(formatted);
        }
        return;
      }
      setResult(null);
      setExpr((e) => (e + value).slice(0, 64));
    },
    [expr]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    let value: string | null = null;
    if (/^[0-9.()%]$/.test(k)) value = k;
    else if (k === "+") value = "+";
    else if (k === "-") value = "−";
    else if (k === "*" || k === "x") value = "×";
    else if (k === "/") value = "÷";
    else if (k === "Enter" || k === "=") value = "equals";
    else if (k === "Backspace") value = "back";
    else if (k === "Delete" || k.toLowerCase() === "c") value = "clear";
    // Everything typed here stays here. Escape is let through to close.
    if (k !== "Escape") e.stopPropagation();
    if (value) {
      e.preventDefault();
      press(value);
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="w-60 outline-none"
      aria-label="Calculator"
      data-qbank-capture-keys
    >
      <div
        className="mb-2 rounded-md px-3 py-2 text-right"
        style={{ border: "1px solid var(--border)", background: "var(--bg)" }}
      >
        <p className="min-h-[16px] truncate text-[11px] tabular-nums" style={{ color: "var(--fg-muted)" }}>
          {result !== null ? expr || " " : " "}
        </p>
        <p className="truncate text-xl tabular-nums" style={{ color: result === "Error" ? "var(--signal)" : "var(--fg)" }}>
          {result ?? (expr || "0")}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            onClick={() => press(key.value)}
            className="h-9 rounded-md text-sm font-medium transition-opacity hover:opacity-80"
            style={
              key.kind === "equals"
                ? { background: "var(--fg)", color: "var(--bg)" }
                : key.kind
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { background: "var(--bg-subtle)", color: "var(--fg)", border: "1px solid var(--border)" }
            }
          >
            {key.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => press("back")}
        className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs transition-opacity hover:opacity-80"
        style={{ border: "1px solid var(--border)", color: "var(--fg-muted)" }}
      >
        <Delete className="h-3.5 w-3.5" /> Backspace
      </button>
    </div>
  );
};

export default QBankCalculator;
