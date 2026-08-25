import { useState } from "react";

// All four medical-notes modes (sheet, cards, explain, enhance) share one
// 10-turn memory window per user, so this preference must be shared across
// their call sites too — not local state read by only one of them. Follows
// the same localStorage-backed pattern as use-persona.ts.
const KEY = "sb_use_memory_v1";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "false"; // default true
  } catch {
    return true;
  }
}

export function useMemoryPreference() {
  const [useMemory, setUseMemoryState] = useState<boolean>(read);

  const setUseMemory = (v: boolean) => {
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // quota exceeded — this is a convenience preference only
    }
    setUseMemoryState(v);
  };

  return { useMemory, setUseMemory };
}
