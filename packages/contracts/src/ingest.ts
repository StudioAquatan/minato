import { z } from "zod";

export const RegisterFileRequestSchema = z.object({
  path: z.string().min(1),
  source: z.string().optional(),
});

export const RegisterFileResponseSchema = z.object({
  fileId: z.string(),
  sha256: z.string(),
  isDuplicate: z.boolean(),
  jobId: z.string().nullable(),
});

export type RegisterFileRequest = z.infer<typeof RegisterFileRequestSchema>;
export type RegisterFileResponse = z.infer<
  typeof RegisterFileResponseSchema
>;
