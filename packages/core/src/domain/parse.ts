import type { FileId } from "./ids.js";
import type { PageBBox } from "./chunk.js";

export type PdfParseInput = {
  fileId: FileId;
  absolutePath: string;
  sha256: string;
};

export type ParsedElementKind =
  | "title"
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "figure_caption"
  | "footnote"
  | "reference"
  | "other";

export type ParsedElement = {
  kind: ParsedElementKind;
  headingLevel: number | null;
  text: string;
  page: number;
  bbox: PageBBox;
};

export type ParseQuality = {
  charsPerPage: number;
  garbleRatio: number;
  headingCount: number;
  referenceCount: number;
  usedOcr: boolean;
  headerFieldsPresent: number;
  headerFieldsRequired: number;
  grobidAvailable: boolean;
};

export type ParsedAuthor = {
  fullName: string;
  affiliation: string | null;
};

export type ParsedReference = {
  ordinal: number;
  teiId: string | null;
  raw: string;
  doi: string | null;
  title: string | null;
  authorsHint: string | null;
  year: number | null;
  venue: string | null;
};

export type ParsedCitationContext = {
  refTeiId: string;
  marker: string | null;
  snippet: string;
  page: number;
  bbox: PageBBox | null;
};

export type ParsedDocument = {
  fileId: FileId;
  sha256: string;
  parserVersion: string;
  lang: string;
  title: string | null;
  titleJa: string | null;
  authors: ParsedAuthor[];
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  year: number | null;
  venue: string | null;
  pageCount: number;
  elements: ParsedElement[];
  references: ParsedReference[];
  citationContexts: ParsedCitationContext[];
  teiXml: string | null;
  quality: ParseQuality;
};
