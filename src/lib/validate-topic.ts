/**
 * The edge function's own topic checks, re-exported so the flashcards page
 * judges a topic exactly as the server will (see repair-llm-json.ts for the
 * same arrangement).
 */
export {
  TOPIC_MAX_LENGTH,
  topicRejectionMessage,
  validateTopic,
  type TopicRejection,
} from "../../supabase/functions/_shared/validate-topic.ts";
export { parseDecline } from "../../supabase/functions/_shared/topic-decline.ts";
