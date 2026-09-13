// The QBank calculator's evaluator.
//
// A shunting-yard parser over + − × ÷, parentheses, unary minus and percent,
// so the calculator never hands a string to eval or Function. Returns null for
// anything it cannot evaluate to a finite number, including division by zero.

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "neg" }
  | { kind: "pct" }
  | { kind: "lparen" }
  | { kind: "rparen" };

const PRECEDENCE: Record<"+" | "-" | "*" | "/" | "neg", number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  neg: 3,
};

const normalizeOperator = (ch: string): string =>
  ch === "×" || ch === "x" ? "*" : ch === "÷" ? "/" : ch === "−" ? "-" : ch;

const tokenize = (input: string): Token[] | null => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = normalizeOperator(input[i]);
    if (ch === " ") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const raw = input.slice(i, j);
      if ((raw.match(/\./g) ?? []).length > 1 || raw === ".") return null;
      tokens.push({ kind: "num", value: parseFloat(raw) });
      i = j;
      continue;
    }
    if (ch === "(") tokens.push({ kind: "lparen" });
    else if (ch === ")") tokens.push({ kind: "rparen" });
    else if (ch === "%") tokens.push({ kind: "pct" });
    else if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      const prev = tokens[tokens.length - 1];
      const unary = !prev || prev.kind === "op" || prev.kind === "lparen";
      if (unary && ch === "-") tokens.push({ kind: "op", value: "neg" });
      else if (unary && ch === "+") {
        /* unary plus is a no-op */
      } else tokens.push({ kind: "op", value: ch });
    } else return null;
    i++;
  }
  return tokens;
};

export const evaluate = (input: string): number | null => {
  const tokens = tokenize(input);
  if (!tokens || tokens.length === 0) return null;

  const output: number[] = [];
  const ops: Token[] = [];

  const apply = (op: Token): boolean => {
    if (op.kind !== "op") return false;
    if (op.value === "neg") {
      if (output.length < 1) return false;
      output.push(-output.pop()!);
      return true;
    }
    if (output.length < 2) return false;
    const b = output.pop()!;
    const a = output.pop()!;
    switch (op.value) {
      case "+": output.push(a + b); break;
      case "-": output.push(a - b); break;
      case "*": output.push(a * b); break;
      case "/":
        if (b === 0) return false;
        output.push(a / b);
        break;
    }
    return true;
  };

  for (const t of tokens) {
    if (t.kind === "num") output.push(t.value);
    else if (t.kind === "pct") {
      if (output.length < 1) return null;
      output.push(output.pop()! / 100);
    } else if (t.kind === "op") {
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.kind !== "op") break;
        // neg is right-associative; binary operators are left-associative.
        const higher =
          t.value === "neg"
            ? PRECEDENCE[top.value] > PRECEDENCE[t.value]
            : PRECEDENCE[top.value] >= PRECEDENCE[t.value];
        if (!higher) break;
        if (!apply(ops.pop()!)) return null;
      }
      ops.push(t);
    } else if (t.kind === "lparen") ops.push(t);
    else {
      let matched = false;
      while (ops.length) {
        const top = ops.pop()!;
        if (top.kind === "lparen") {
          matched = true;
          break;
        }
        if (!apply(top)) return null;
      }
      if (!matched) return null;
    }
  }

  while (ops.length) {
    const top = ops.pop()!;
    if (top.kind === "lparen") return null;
    if (!apply(top)) return null;
  }

  if (output.length !== 1 || !Number.isFinite(output[0])) return null;
  return output[0];
};

/** Formats a result for the display: no float noise, no runaway digits. */
export const formatResult = (n: number): string => {
  const rounded = Math.round(n * 1e10) / 1e10;
  const s = String(rounded);
  return s.length > 14 ? rounded.toPrecision(10).replace(/\.?0+(e|$)/, "$1") : s;
};
