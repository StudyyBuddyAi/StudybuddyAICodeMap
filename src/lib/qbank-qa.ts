/**
 * The QBank QA gate, as the browser sees it.
 *
 * The rules themselves live in supabase/functions/_shared/qbank-qa.ts, because
 * the edge function now runs them before the insert so the findings can be
 * stored on the row and returned with the batch. This file is a re-export so
 * the app and the unit tests import the same code the server ran — previously
 * the gate lived here and ran only in the browser, after persistence, and its
 * results were discarded when the page unmounted.
 *
 * The shared module has no imports and touches no Deno API, so it bundles into
 * the client unchanged.
 */

export type {
  QaSeverity,
  QaFinding,
  QaResult,
  CheckableQuestion,
} from "../../supabase/functions/_shared/qbank-qa.ts";

export {
  checkQuestion,
  checkBatch,
} from "../../supabase/functions/_shared/qbank-qa.ts";
