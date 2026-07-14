import type {
  BiblioResolver,
  ChunkRepository,
  CitationRepository,
  FileRepository,
  IndexAdmin,
  IndexGenerationRepository,
  JobQueue,
  PaperMatcher,
  PaperRepository,
  PdfParser,
  PdfStorage,
  SearchIndex,
  SectionRepository,
  Embedder,
  Clock,
  IdGen,
} from "../ports/index.js";
import type { ChunkerConfig } from "../services/chunker.js";

export type Deps = {
  papers: PaperRepository;
  files: FileRepository;
  sections: SectionRepository;
  chunks: ChunkRepository;
  citations?: CitationRepository;
  jobs: JobQueue;
  storage: PdfStorage;
  parser: PdfParser;
  searchIndex: SearchIndex;
  indexAdmin: IndexAdmin;
  indexGens: IndexGenerationRepository;
  embedder: Embedder;
  clock: Clock;
  idGen: IdGen;
  chunker: ChunkerConfig;
  matcher?: PaperMatcher;
  biblio?: BiblioResolver;
};
