import type {
  OaPdfCandidate,
  ParsedDocument,
  PaperMatchInput,
  PdfParseInput,
  ResolvedReference,
  RefString,
  PaperMatchResult,
} from "../domain/index.js";

export interface PdfParser {
  readonly parserVersion: string;
  parse(inputs: PdfParseInput[]): Promise<ParsedDocument[]>;
}

export interface BiblioResolver {
  readonly version: string;
  resolve(ref: RefString): Promise<ResolvedReference | null>;
  findOaPdf(ref: ResolvedReference): Promise<OaPdfCandidate | null>;
}

export interface PaperMatcher {
  readonly version: string;
  match(input: PaperMatchInput): Promise<PaperMatchResult>;
}
