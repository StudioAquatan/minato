import type {
  OaPdfCandidate,
  ParsedDocument,
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
  resolve(ref: RefString): Promise<ResolvedReference | null>;
  findOaPdf(ref: ResolvedReference): Promise<OaPdfCandidate | null>;
}

export interface PaperMatcher {
  match(ref: RefString): Promise<PaperMatchResult>;
}
