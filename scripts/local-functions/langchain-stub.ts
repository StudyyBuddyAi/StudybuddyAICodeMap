/**
 * Stands in for `npm:@langchain/openai` in the dev server (vite-plugin.ts).
 *
 * Embedding a sheet's topic for retrieval is an OpenRouter call; locally it
 * fails instead, and the handler writes the sheet ungrounded, as it does in
 * production whenever retrieval fails.
 */
export class OpenAIEmbeddings {
  constructor(_options: unknown) {}

  embedQuery(_text: string): Promise<number[]> {
    return Promise.reject(new Error("local stand-in: retrieval is off in the dev server"));
  }
}
