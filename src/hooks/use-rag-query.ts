import { useMutation } from "@tanstack/react-query";
import { callRagGenerate, RagGenerateParams, RagGenerateResponse } from "@/lib/callRagGenerate";

export function useRagQuery() {
  return useMutation<RagGenerateResponse, Error, RagGenerateParams>({
    mutationFn: (params) => callRagGenerate(params),
  });
}
