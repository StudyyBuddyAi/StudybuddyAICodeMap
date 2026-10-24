import { useCallback, useEffect, useRef, useState } from "react";

/** Pause in typing after which a note is written back to the set. */
const COMMIT_MS = 400;

/**
 * A note being typed: local while the student types, written back to the set
 * after a pause, on blur, on a change of question, and on unmount. Typing never
 * re-renders the whole player one keystroke at a time.
 */
export const useNoteDraft = (
  questionId: string,
  value: string,
  onChange: (questionId: string, text: string) => void
) => {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  const pending = useRef<{ id: string; text: string } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) onChangeRef.current(pending.current.id, pending.current.text);
    pending.current = null;
  }, []);

  // A different question brings its own note; anything typed for the last one
  // is written first.
  useEffect(() => {
    flush();
    setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  useEffect(() => () => flush(), [flush]);

  const update = useCallback(
    (text: string) => {
      setDraft(text);
      pending.current = { id: questionId, text };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, COMMIT_MS);
    },
    [questionId, flush]
  );

  return { draft, update, flush };
};
