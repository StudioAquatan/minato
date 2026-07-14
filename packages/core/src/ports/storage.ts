export interface PdfStorage {
  readonly root: string;
  /** Move/copy a file into storage keyed by SHA-256; returns relative path. */
  store(sourcePath: string, sha256: string): Promise<{
    relativePath: string;
    absolutePath: string;
    byteSize: number;
  }>;
  absolutePathFor(relativePath: string): string;
  read(relativePath: string): Promise<Buffer>;
  quarantine(relativePath: string): Promise<string>;
}
