import { callQbankGenerate } from "./callQbankGenerate";
import { parsePartialQuestions } from "./parse-partial-questions";
import { DISPUTED_REASON } from "./qbank-rule-labels";
import type { GeneratedQuestionDraft } from "./qbank-types";

/**
 * Turns a target number of questions into a sequence of generation waves.
 *
 * The edge function writes one wave — five questions in about ninety seconds,
 * the shape it has been running at all along. A set of twenty is four of those
 * back to back, because twenty in a single request is roughly six minutes of
 * wall clock and no edge runtime should be asked to hold that.
 *
 * ── Why the loop counts questions, not waves ────────────────────────────────
 *
 * Every step of a wave can quietly produce fewer questions than it was asked
 * for: the model can emit an item that fails validation, the QA gate can hold
 * one back, an insert can fail, a stream can die halfway. If the loop counted
 * waves it would hand the student sixteen questions and call it twenty.
 *
 * So it is driven by the target instead: keep starting waves until the set is
 * full, each one asking only for the shortfall. A wave that yields three makes
 * the next wave ask for the missing two, and the arithmetic works out on its
 * own with no special top-up path. Since a set is cheap relative to a student's
 * time, the loop is generous about retrying — but it is bounded in three
 * independent ways so it can never spin: a wave budget, a run of empty waves,
 * and a per-wave stall timeout.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not track question ids. Ids reach the session through
 * claim_generated_questions, which reconciles against the table by generation
 * id, so a question that was written while the client was disconnected is still
 * found later. The `questionReady` events this runner reports are a prompt to go
 * and reconcile, not a record of what exists. That is the whole reason a crash
 * mid-generation costs nothing that was already paid for.
 */

/** Questions per wave. Matches the ~90s request shape already proven in production. */
export const WAVE_SIZE = 5;

/** The set sizes a student can pick. */
export const MIN_SET_SIZE = 5;
export const MAX_SET_SIZE = 20;
export const SET_SIZE_STEP = 5;

/**
 * Extra waves allowed beyond the ideal count, to absorb shortfalls.
 *
 * A perfect run of twenty needs four waves. Four spare covers a fairly bad run —
 * every wave losing an item to the gate — without ever letting a model that has
 * started producing garbage bill indefinitely.
 */
const EXTRA_WAVE_BUDGET = 4;

/** Consecutive waves that deliver nothing before the run is abandoned. */
const MAX_CONSECUTIVE_EMPTY_WAVES = 3;

/** Immediate re-attempts when a wave cannot even be started. */
const WAVE_CONNECT_RETRIES = 2;

/** Backoff before each re-attempt, indexed by attempt number. */
const RETRY_BACKOFF_MS = [1_000, 4_000];

/**
 * Silence that means a wave is hung rather than slow.
 *
 * An item takes ~17.6s to write, so two minutes without a single token is not a
 * slow model, it is a dead connection. The writer call has no timeout of its own
 * server-side, so without this a hung upstream would hold the run until the
 * platform killed the isolate and the student would watch a stalled bar.
 */
const STALL_TIMEOUT_MS = 120_000;

export type GenerationStatus = "complete" | "short" | "aborted" | "failed";

/** One question, announced by the edge function once its row is committed. */
export interface QuestionReadyEvent {
  /** Null when the insert failed. The question is lost; the loop makes it up. */
  id: string | null;
  index: number;
  blocked: boolean;
  /** The gate rule that blocked it, when one did. */
  blockRule?: string | null;
  difficulty: string;
  reasoningOrder: string;
  agreed: boolean;
}

/**
 * A question that was written and paid for but never reached the session.
 *
 * Kept per question rather than as a count so the set can say what went wrong
 * rather than only how often. The reason is a gate rule slug, or "disputed"
 * when the blind second read landed somewhere other than the key.
 */
export interface HeldBackItem {
  index: number;
  reason: string;
}

export interface GenerationProgress {
  delivered: number;
  /** Written and paid for, but withheld by the gate or the second read. */
  heldBack: number;
  heldBackItems: HeldBackItem[];
  target: number;
  wave: number;
  system: string | null;
  systemName: string | null;
  /**
   * Where a resumed run would have to pick up. Reported after every wave and
   * persisted by the caller, because a run interrupted by a refresh has to
   * resume at the right index — restarting at one would give two questions the
   * same position and the set would be ordered arbitrarily.
   */
  nextIndex: number;
  /** Subtopics covered so far, so a resumed run keeps the duplication guard. */
  covered: string[];
}

export interface GenerationOutcome {
  status: GenerationStatus;
  delivered: number;
  /** Written and paid for, but withheld by the gate or the second read. */
  heldBack: number;
  heldBackItems: HeldBackItem[];
  target: number;
  waves: number;
  systemName: string | null;
  /** Set for "failed", and for "short" when a reason is known. */
  error: string | null;
}

export interface RunGenerationOptions {
  topic: string;
  target: number;
  generationId: string;
  signal: AbortSignal;
  waveSize?: number;
  /** Injected in tests. Defaults to the real edge-function call. */
  call?: typeof callQbankGenerate;
  /** The resolved system and model, once the first wave reports them. */
  onMeta?: (meta: { systemName: string; model: string }) => void;
  /** In-flight drafts for the progress display. Never rendered as questions. */
  onDrafts?: (drafts: GeneratedQuestionDraft[]) => void;
  /** Awaited, so the first question can start a session before the next lands. */
  onQuestionReady: (event: QuestionReadyEvent) => void | Promise<void>;
  onProgress?: (progress: GenerationProgress) => void;
  /** Stops the run early — the student finished the session, say. */
  shouldContinue?: () => boolean;
  /** Resuming an interrupted set: where to number the next wave from. */
  startIndex?: number;
  /** Resuming: subtopics the earlier waves already covered. */
  alreadyCovered?: string[];
  /** Resuming: the system the set was routed to, so the brief does not change. */
  system?: string | null;
  /** The reasoning-order mix the student asked for. Echoed on every wave. */
  challenge?: string;
  /** The exam the set is for. Echoed on every wave, like `challenge`. */
  examMode?: string;
  /**
   * Overrides the retry backoff. Exists so the tests can exercise the give-up
   * paths without sitting through five real seconds per empty wave.
   */
  retryBackoffMs?: number[];
}

interface WaveResult {
  /**
   * Questions that landed AND are playable: committed, past the QA gate, and
   * agreed with by the blind second read. The same three tests
   * claim_generated_questions applies, so this count is what the session will
   * actually receive.
   */
  playable: number;
  /** Committed but withheld — gate-blocked, or the second read disagreed. */
  heldBack: number;
  heldBackItems: HeldBackItem[];
  subtopics: string[];
  system: string | null;
  systemName: string | null;
  streamError: string | null;
  /** Non-retryable. Ends the whole run rather than the wave. */
  fatal: string | null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

const isAbort = (err: unknown) =>
  err instanceof DOMException ? err.name === "AbortError" : (err as Error)?.name === "AbortError";

/**
 * Runs one wave and reports what actually landed.
 *
 * The playable count is taken from the per-question events rather than from the
 * wave's closing summary, because the summary is the one frame guaranteed not to
 * arrive when a stream dies — and a wave that wrote four questions and then lost
 * its connection has still written four questions.
 */
async function runWave(
  params: {
    topic: string;
    count: number;
    generationId: string;
    system: string | null;
    startIndex: number;
    avoidSubtopics: string[];
    challenge?: string;
    examMode?: string;
  },
  opts: RunGenerationOptions
): Promise<WaveResult> {
  const call = opts.call ?? callQbankGenerate;
  const result: WaveResult = {
    playable: 0,
    heldBack: 0,
    heldBackItems: [],
    subtopics: [],
    system: params.system,
    systemName: null,
    streamError: null,
    fatal: null,
  };

  // A stall watchdog layered over the caller's signal, so a hung upstream ends
  // this wave without ending the run.
  const ac = new AbortController();
  const abortOuter = () => ac.abort();
  opts.signal.addEventListener("abort", abortOuter, { once: true });
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; ac.abort(); }, STALL_TIMEOUT_MS);
  };

  let drafts: GeneratedQuestionDraft[] = [];
  // Whether the wave closed the way this client's protocol says it should. A
  // stream that ends cleanly without ever sending one is not a failed wave, it
  // is a server that does not speak this protocol — see the check below.
  let sawWaveComplete = false;

  try {
    kick();
    const response = await call(
      {
        topic: params.topic,
        count: params.count,
        generationId: params.generationId,
        system: params.system ?? undefined,
        startIndex: params.startIndex,
        avoidSubtopics: params.avoidSubtopics,
        challenge: params.challenge,
        examMode: params.examMode,
      },
      { signal: ac.signal }
    );

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      const message = body?.error ?? `Generation failed (${response.status})`;
      // 401 and 400 will fail identically however many times they are retried:
      // an expired token or a malformed request is not a transient condition.
      if (response.status === 401 || response.status === 400) result.fatal = message;
      result.streamError = message;
      return result;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      kick();

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const data = dataLine.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const meta = parsed.__meta as Record<string, unknown> | undefined;
        if (meta) {
          if (typeof meta.systemName === "string") {
            result.systemName = meta.systemName;
            if (typeof meta.system === "string") result.system = meta.system;
            opts.onMeta?.({
              systemName: meta.systemName,
              model: typeof meta.model === "string" ? meta.model : "",
            });
          }

          // The server re-ran a wave that had produced nothing. The partial JSON
          // already streamed is about to be replaced, so the draft display has
          // to forget it.
          if (meta.restart === true) {
            content = "";
            drafts = [];
            opts.onDrafts?.([]);
            continue;
          }

          const ready = meta.questionReady as QuestionReadyEvent | undefined;
          if (ready) {
            const withheld = ready.blocked || ready.agreed === false;
            if (ready.id && withheld) {
              result.heldBack++;
              result.heldBackItems.push({
                index: ready.index,
                reason: ready.blocked
                  ? ready.blockRule || "quality-gate"
                  : DISPUTED_REASON,
              });
            }
            if (ready.id && !withheld) result.playable++;
            // Awaited: the first of these starts the session, and the second
            // must not race it into starting a second one.
            await opts.onQuestionReady(ready);
            continue;
          }

          const summary = meta.waveComplete as Record<string, unknown> | undefined;
          if (summary) {
            sawWaveComplete = true;
            if (Array.isArray(summary.subtopics)) {
              result.subtopics = summary.subtopics.filter(
                (s): s is string => typeof s === "string" && !!s
              );
            }
            if (typeof summary.system === "string") result.system = summary.system;
            if (typeof summary.systemName === "string") result.systemName = summary.systemName;

            /**
             * A wave that wrote questions and could not commit a single one.
             *
             * This is the sibling of the out-of-date-function check below, and
             * it is here for the same reason: retrying cannot fix it. An insert
             * the database refuses is refused for every question equally — a
             * column the deployed function writes that the table does not have
             * is the usual cause — so the loop would spend its two connect
             * retries and three empty waves, about nine generations, and then
             * blame the student's topic for a schema that is behind.
             *
             * Gated on nothing having landed. A wave that committed some of its
             * questions and lost others is the ordinary shortfall persistOne was
             * built to absorb, and the next wave replaces them.
             */
            const insertFailures =
              typeof summary.insertFailures === "number" ? summary.insertFailures : 0;
            const persisted = typeof summary.persisted === "number" ? summary.persisted : 0;
            if (insertFailures > 0 && persisted === 0) {
              // The database's own words — a column-name like `exam_mode` or a
              // table name — can be a map of the schema, so they never cross the
              // boundary. The counts are enough; the server logs the reason.
              result.fatal =
                "The questions were written but none of them could be saved." +
                " The database schema is probably behind the deployed function — apply the pending migrations and try again.";
            }
          }
          continue;
        }

        const delta = (parsed as { choices?: { delta?: { content?: unknown } }[] })
          ?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          content += delta;
          drafts = parsePartialQuestions(content);
          opts.onDrafts?.(drafts);
        }
      }
    }
  } catch (err) {
    if (isAbort(err) && !stalled) throw err; // the caller cancelled: propagate
    result.streamError = stalled
      ? "The model stopped responding."
      : err instanceof Error
        ? err.message
        : String(err);
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal.removeEventListener("abort", abortOuter);
  }

  /**
   * A wave that ran to completion without ever sending a waveComplete frame is
   * an out-of-date edge function, not a bad generation.
   *
   * The previous qbank-generate wrote its whole batch after the model stopped
   * and announced it in one closing frame; it has no concept of a question being
   * ready, and none of the frames this client counts. Retried against it, every
   * wave looks empty, so the loop spends nine full generations — about thirteen
   * minutes and the tokens to match — before reporting something misleading
   * about the topic. Naming it as fatal turns that into an immediate, accurate
   * error.
   *
   * Gated on the stream having ended cleanly: a dropped connection also loses
   * this frame, and that genuinely is a wave worth retrying.
   */
  if (!result.streamError && !sawWaveComplete) {
    result.fatal =
      "The question generator on the server is out of date. Deploy the qbank-generate function and try again.";
    return result;
  }

  // The closing summary is the frame most likely to be missing after a dropped
  // stream, so fall back to the subtopics the client parsed for itself. Without
  // this the next wave loses its duplication guard exactly when the set is most
  // likely to be re-covering ground.
  if (result.subtopics.length === 0 && drafts.length > 0) {
    result.subtopics = drafts.map((d) => d.subtopic).filter(Boolean);
  }

  return result;
}

/**
 * Generates `target` questions as a sequence of waves, reporting each question
 * the moment its row is committed.
 *
 * Never throws for a generation failure — it returns an outcome. A run that ends
 * short is a real, expected result that the session has to be able to show
 * honestly, not an exception to swallow at a call site.
 */
export async function runQbankGeneration(
  opts: RunGenerationOptions
): Promise<GenerationOutcome> {
  const waveSize = opts.waveSize ?? WAVE_SIZE;
  const target = Math.max(1, Math.round(opts.target));
  const maxWaves = Math.ceil(target / waveSize) + EXTRA_WAVE_BUDGET;

  let delivered = 0;
  let heldBack = 0;
  const heldBackItems: HeldBackItem[] = [];
  let waves = 0;
  let emptyStreak = 0;
  let nextIndex = Math.max(1, Math.round(opts.startIndex ?? 1));
  let system: string | null = opts.system ?? null;
  let systemName: string | null = null;
  let lastError: string | null = null;
  const covered = new Set<string>(opts.alreadyCovered ?? []);

  while (delivered < target) {
    if (opts.signal.aborted) {
      return { status: "aborted", delivered, heldBack, heldBackItems, target, waves, systemName, error: null };
    }
    if (opts.shouldContinue && !opts.shouldContinue()) {
      return { status: "short", delivered, heldBack, heldBackItems, target, waves, systemName, error: null };
    }
    if (waves >= maxWaves || emptyStreak >= MAX_CONSECUTIVE_EMPTY_WAVES) break;

    const want = Math.min(waveSize, target - delivered);
    waves++;

    let wave: WaveResult | null = null;
    for (let attempt = 0; attempt <= WAVE_CONNECT_RETRIES; attempt++) {
      try {
        wave = await runWave(
          {
            topic: opts.topic,
            count: want,
            generationId: opts.generationId,
            system,
            startIndex: nextIndex,
            avoidSubtopics: [...covered],
            challenge: opts.challenge,
            examMode: opts.examMode,
          },
          opts
        );
      } catch (err) {
        if (isAbort(err)) {
          return { status: "aborted", delivered, heldBack, heldBackItems, target, waves, systemName, error: null };
        }
        wave = null;
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (wave?.fatal) {
        return { status: "failed", delivered, heldBack, heldBackItems, target, waves, systemName, error: wave.fatal };
      }
      // Only a wave that produced nothing at all is worth re-attempting straight
      // away; one that produced something has already advanced the set, and the
      // shortfall is the outer loop's job.
      if (wave && wave.playable > 0) break;
      if (attempt < WAVE_CONNECT_RETRIES) {
        const backoff = opts.retryBackoffMs ?? RETRY_BACKOFF_MS;
        await sleep(backoff[attempt] ?? backoff[backoff.length - 1] ?? 4_000, opts.signal);
        if (opts.signal.aborted) {
          return { status: "aborted", delivered, heldBack, heldBackItems, target, waves, systemName, error: null };
        }
      }
    }

    if (!wave) {
      emptyStreak++;
      continue;
    }

    system = wave.system ?? system;
    systemName = wave.systemName ?? systemName;
    if (wave.streamError) lastError = wave.streamError;
    wave.subtopics.forEach((s) => covered.add(s));

    delivered += wave.playable;
    heldBack += wave.heldBack;
    heldBackItems.push(...wave.heldBackItems);
    // Advanced by what was ASKED for, not by what landed, so two waves can never
    // be numbered over the top of each other. The set is then ordered by index
    // with no collisions even when a wave delivers nothing.
    nextIndex += want;
    emptyStreak = wave.playable > 0 ? 0 : emptyStreak + 1;

    opts.onProgress?.({
      delivered,
      heldBack,
      heldBackItems: [...heldBackItems],
      target,
      wave: waves,
      system,
      systemName,
      nextIndex,
      covered: [...covered],
    });
  }

  if (delivered >= target) {
    return { status: "complete", delivered, heldBack, heldBackItems, target, waves, systemName, error: null };
  }
  if (delivered === 0) {
    return {
      status: "failed",
      delivered,
      heldBack,
      heldBackItems,
      target,
      waves,
      systemName,
      error: lastError ?? "No questions could be generated for that topic.",
    };
  }
  return { status: "short", delivered, heldBack, heldBackItems, target, waves, systemName, error: lastError };
}
