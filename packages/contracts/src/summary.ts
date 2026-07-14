import { z } from "zod";

export const SummarySchema = z.object({
  researchQuestion: z.string(),
  method: z.string(),
  keyFindings: z.array(z.string()),
  limitations: z.array(z.string()),
  positioning: z.string(),
  keywords: z.array(z.string()),
});

export type Summary = z.infer<typeof SummarySchema>;
