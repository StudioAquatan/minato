import { createHash } from "node:crypto";
import type {
  Chunk,
  ChunkId,
  PageBBox,
  ParsedDocument,
  ParsedElement,
  PaperId,
  Section,
  SectionId,
} from "../domain/index.js";
import type { IdGen } from "../ports/index.js";

export type ChunkerConfig = {
  version: string;
  parserVersion: string;
  targetCharCount: number;
  overlapCharCount: number;
  maxCharCount: number;
};

export const defaultChunkerConfig = (parserVersion: string): ChunkerConfig => ({
  version: "chunker-v1",
  parserVersion,
  targetCharCount: 1200,
  overlapCharCount: 150,
  maxCharCount: 1800,
});

type SectionAccumulator = {
  ordinal: number;
  level: number | null;
  title: string | null;
  elements: ParsedElement[];
};

const isHeading = (el: ParsedElement) =>
  el.kind === "heading" || el.kind === "title";

const cleanText = (s: string) => s.replace(/[\t\r]+/g, " ").trim();

const joinBBoxes = (elements: ParsedElement[]): PageBBox[] => {
  const byPage = new Map<number, PageBBox>();
  for (const el of elements) {
    const existing = byPage.get(el.page);
    if (existing) {
      byPage.set(el.page, {
        page: el.page,
        x0: Math.min(existing.x0, el.bbox.x0),
        y0: Math.min(existing.y0, el.bbox.y0),
        x1: Math.max(existing.x1, el.bbox.x1),
        y1: Math.max(existing.y1, el.bbox.y1),
      });
    } else {
      byPage.set(el.page, { ...el.bbox });
    }
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
};

const contentHashOf = (s: string) =>
  createHash("sha256").update(s).digest("hex");

const groupSections = (doc: ParsedDocument): SectionAccumulator[] => {
  const sections: SectionAccumulator[] = [];
  let current: SectionAccumulator = {
    ordinal: 0,
    level: null,
    title: null,
    elements: [],
  };
  for (const el of doc.elements) {
    if (isHeading(el)) {
      if (current.elements.length > 0 || current.title !== null) {
        sections.push(current);
      }
      current = {
        ordinal: sections.length,
        level: el.headingLevel ?? 1,
        title: cleanText(el.text),
        elements: [],
      };
    } else {
      current.elements.push(el);
    }
  }
  if (current.elements.length > 0 || current.title !== null) {
    sections.push(current);
  }
  return sections;
};

type PendingChunk = {
  sectionOrdinal: number | null;
  elements: ParsedElement[];
  buffer: string;
};

const flushChunk = (
  pending: PendingChunk,
  paperId: PaperId,
  ordinal: number,
  sectionIdByOrdinal: Map<number, SectionId>,
  cfg: ChunkerConfig,
  idGen: IdGen,
): Chunk | null => {
  const text = cleanText(pending.buffer);
  if (!text) return null;
  const bboxes = joinBBoxes(pending.elements);
  const pageFrom = pending.elements.length
    ? Math.min(...pending.elements.map((e) => e.page))
    : 1;
  const pageTo = pending.elements.length
    ? Math.max(...pending.elements.map((e) => e.page))
    : 1;
  return {
    id: idGen.newId("chk") as ChunkId,
    paperId,
    sectionId:
      pending.sectionOrdinal !== null
        ? sectionIdByOrdinal.get(pending.sectionOrdinal) ?? null
        : null,
    ordinal,
    text,
    pageFrom,
    pageTo,
    bboxes,
    tokenCount: null,
    contentHash: contentHashOf(text),
    parserVersion: cfg.parserVersion,
    chunkerVersion: cfg.version,
  };
};

export type ChunkResult = {
  sections: Section[];
  chunks: Chunk[];
};

export const chunkDocument = (
  paperId: PaperId,
  doc: ParsedDocument,
  cfg: ChunkerConfig,
  idGen: IdGen,
): ChunkResult => {
  const secs = groupSections(doc);
  const sections: Section[] = [];
  const sectionIdByOrdinal = new Map<number, SectionId>();
  for (const s of secs) {
    const id = idGen.newId("sec") as SectionId;
    sectionIdByOrdinal.set(s.ordinal, id);
    const pages = s.elements.length
      ? s.elements.map((e) => e.page)
      : [1];
    sections.push({
      id,
      paperId,
      ordinal: s.ordinal,
      level: s.level,
      title: s.title,
      pageFrom: Math.min(...pages),
      pageTo: Math.max(...pages),
    });
  }

  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const s of secs) {
    let pending: PendingChunk = {
      sectionOrdinal: s.ordinal,
      elements: [],
      buffer: "",
    };
    const pushElement = (el: ParsedElement) => {
      const t = cleanText(el.text);
      if (!t) return;
      const separator = pending.buffer.length ? "\n\n" : "";
      const wouldExceed =
        pending.buffer.length + separator.length + t.length >
        cfg.maxCharCount;
      if (wouldExceed && pending.buffer.length >= cfg.targetCharCount) {
        const finished = flushChunk(
          pending,
          paperId,
          ordinal,
          sectionIdByOrdinal,
          cfg,
          idGen,
        );
        if (finished) {
          chunks.push(finished);
          ordinal += 1;
        }
        const overlap =
          cfg.overlapCharCount > 0
            ? pending.buffer.slice(-cfg.overlapCharCount)
            : "";
        pending = {
          sectionOrdinal: s.ordinal,
          elements: [el],
          buffer: overlap ? `${overlap}\n\n${t}` : t,
        };
      } else {
        pending.elements.push(el);
        pending.buffer = pending.buffer.length
          ? `${pending.buffer}${separator}${t}`
          : t;
      }
    };
    for (const el of s.elements) {
      pushElement(el);
    }
    const finished = flushChunk(
      pending,
      paperId,
      ordinal,
      sectionIdByOrdinal,
      cfg,
      idGen,
    );
    if (finished) {
      chunks.push(finished);
      ordinal += 1;
    }
  }

  return { sections, chunks };
};
