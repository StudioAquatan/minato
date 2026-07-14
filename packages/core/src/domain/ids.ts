export type PaperId = string & { readonly __brand: "PaperId" };
export type FileId = string & { readonly __brand: "FileId" };
export type ChunkId = string & { readonly __brand: "ChunkId" };
export type SectionId = string & { readonly __brand: "SectionId" };
export type ReferenceId = string & { readonly __brand: "ReferenceId" };
export type CitationId = string & { readonly __brand: "CitationId" };
export type JobId = string & { readonly __brand: "JobId" };
export type ApprovalId = string & { readonly __brand: "ApprovalId" };
export type IndexGenerationId = string & { readonly __brand: "IndexGenerationId" };

export const asPaperId = (v: string) => v as PaperId;
export const asFileId = (v: string) => v as FileId;
export const asChunkId = (v: string) => v as ChunkId;
export const asSectionId = (v: string) => v as SectionId;
export const asReferenceId = (v: string) => v as ReferenceId;
export const asCitationId = (v: string) => v as CitationId;
export const asJobId = (v: string) => v as JobId;
export const asApprovalId = (v: string) => v as ApprovalId;
export const asIndexGenerationId = (v: string) =>
  v as IndexGenerationId;
