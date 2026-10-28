// The model list and the picked model (GET /api/llm/models, PUT /api/llm/selection),
// shared by the topbar model menu and Coder's /model command.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPut } from './client';
import type { EmbeddingProviderId, EmbeddingsResponse, ModelInfo, ModelsResponse } from './types';

export const MODELS_KEY = ['llm-models'];

export function useModels() {
  return useQuery({
    queryKey: MODELS_KEY,
    queryFn: () => apiFetch<ModelsResponse>('/api/llm/models'),
    refetchInterval: 10000, // states change as models hit and leave rate limits
    retry: 1,
  });
}

/** Pick a model (an id from the list) or null for automatic. */
export function useSelectModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string | null) => apiPut<ModelsResponse>('/api/llm/selection', { model }),
    onSuccess: (data) => qc.setQueryData(MODELS_KEY, data),
  });
}

/** "openai/gpt-oss-120b" -> "gpt-oss-120b": the part people type and read. */
export const shortName = (id: string) => id.split('/').pop()!.replace(/:free$/, '');

/** 1048576 -> "1M", 131072 -> "131k". */
export const contextLabel = (tokens: number) =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}k`;

/**
 * The model meant by what was typed after /model: an exact id, an exact model name,
 * or the only model whose id contains it (case and ':free' ignored).
 */
export function findModel(models: ModelInfo[], typed: string): { match?: ModelInfo; candidates: ModelInfo[] } {
  const raw = typed.trim().toLowerCase();
  // An exact id or model name wins: "nvidia/nemotron-3-ultra-550b-a55b" is NVIDIA's, not OpenRouter's ":free" copy.
  const literal = models.filter((m) => m.id.toLowerCase() === raw || m.model.toLowerCase() === raw);
  if (literal.length === 1) return { match: literal[0], candidates: literal };
  const q = raw.replace(/:free$/, '');
  const norm = (s: string) => s.toLowerCase().replace(/:free$/, '');
  const exact = models.filter((m) => norm(m.id) === q || norm(m.model) === q || norm(shortName(m.id)) === q);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  const partial = models.filter((m) => norm(m.id).includes(q));
  return partial.length === 1 ? { match: partial[0], candidates: partial } : { candidates: exact.length ? exact : partial };
}

export const EMBEDDINGS_KEY = ['embeddings'];

/** Which provider makes the search vectors (GET /api/embeddings). */
export function useEmbeddings() {
  return useQuery({
    queryKey: EMBEDDINGS_KEY,
    queryFn: () => apiFetch<EmbeddingsResponse>('/api/embeddings'),
    refetchInterval: 5000, // adding_vectors empties as repos finish embedding
    retry: 1,
  });
}

/** Switch the embedding provider; repos get its vectors in the background. */
export function useSelectEmbedding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: EmbeddingProviderId) => apiPut<EmbeddingsResponse>('/api/embeddings/selection', { provider }),
    onSuccess: (data) => qc.setQueryData(EMBEDDINGS_KEY, data),
  });
}
