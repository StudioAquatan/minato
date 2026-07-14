import { z } from "zod";

export const SearchFiltersSchema = z.object({
  lang: z.array(z.string()).optional(),
  yearFrom: z.number().int().optional(),
  yearTo: z.number().int().optional(),
  paperIds: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
});

export const SearchRequestSchema = z.object({
  query: z.string(),
  filters: SearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(100).default(10),
  offset: z.number().int().min(0).default(0),
  semanticRatio: z.number().min(0).max(1).default(0.5),
});

export const SearchHitSchema = z.object({
  chunkId: z.string(),
  paperId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  lang: z.string(),
  sectionTitle: z.string().nullable(),
  pageFrom: z.number().int(),
  pageTo: z.number().int(),
  snippet: z.string(),
  score: z.number(),
});

export const SearchResponseSchema = z.object({
  hits: z.array(SearchHitSchema),
  total: z.number().int().nonnegative(),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchHitContract = z.infer<typeof SearchHitSchema>;
