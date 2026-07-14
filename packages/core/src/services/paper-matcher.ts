import type {
  PaperMatchCandidate,
  PaperMatchInput,
  PaperMatchResult,
} from "../domain/index.js";
import type { PaperMatcher, PaperRepository } from "../ports/index.js";

export type PaperMatcherOptions = {
  version?: string;
  strongThreshold?: number;
  weakThreshold?: number;
  yearBonus?: number;
  yearMismatchPenalty?: number;
  authorBonus?: number;
};

const DEFAULT_VERSION = "matcher-v1";
const DEFAULT_STRONG = 0.9;
const DEFAULT_WEAK = 0.6;
const DEFAULT_YEAR_BONUS = 0.1;
const DEFAULT_YEAR_MISMATCH_PENALTY = 0.15;
const DEFAULT_AUTHOR_BONUS = 0.05;

const normalizeDoi = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const trimmed = v.trim().toLowerCase();
  const stripped = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");
  return stripped.length > 0 ? stripped : null;
};

const normalizeTitle = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const lower = v.toLowerCase().normalize("NFKC");
  const cleaned = lower.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
};

const DOI_PATTERN = /(10\.\d{4,9}\/[\-._;()/:a-z0-9]+)/i;
const extractDoiFromRaw = (raw: string): string | null => {
  const m = DOI_PATTERN.exec(raw);
  return m ? normalizeDoi(m[1]) : null;
};

const extractYearFromRaw = (raw: string): number | null => {
  const m = /(19|20)\d{2}/.exec(raw);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
};

const scoreCandidateAdjustments = (
  base: PaperMatchCandidate,
  input: PaperMatchInput,
  paperYear: number | null,
  paperAuthorsHint: string | null,
  opts: Required<PaperMatcherOptions>,
): PaperMatchCandidate => {
  let score = base.score;
  const reasons = [...base.reasons];

  if (input.year != null && paperYear != null) {
    if (paperYear === input.year) {
      score += opts.yearBonus;
      reasons.push("year_match");
    } else if (Math.abs(paperYear - input.year) >= 2) {
      score -= opts.yearMismatchPenalty;
      reasons.push("year_mismatch");
    }
  }

  if (input.authorsHint && paperAuthorsHint) {
    const hint = input.authorsHint.toLowerCase();
    const cand = paperAuthorsHint.toLowerCase();
    const shared = hint
      .split(/[,;]| and /)
      .map((s) => s.trim())
      .filter((s) => s.length > 2)
      .some((token) => cand.includes(token));
    if (shared) {
      score += opts.authorBonus;
      reasons.push("author_overlap");
    }
  }

  return {
    paperId: base.paperId,
    score: Math.max(0, Math.min(1, score)),
    reasons,
  };
};

export const makePaperMatcher = (
  papers: PaperRepository,
  options: PaperMatcherOptions = {},
): PaperMatcher => {
  const opts: Required<PaperMatcherOptions> = {
    version: options.version ?? DEFAULT_VERSION,
    strongThreshold: options.strongThreshold ?? DEFAULT_STRONG,
    weakThreshold: options.weakThreshold ?? DEFAULT_WEAK,
    yearBonus: options.yearBonus ?? DEFAULT_YEAR_BONUS,
    yearMismatchPenalty:
      options.yearMismatchPenalty ?? DEFAULT_YEAR_MISMATCH_PENALTY,
    authorBonus: options.authorBonus ?? DEFAULT_AUTHOR_BONUS,
  };

  return {
    version: opts.version,

    async match(input: PaperMatchInput): Promise<PaperMatchResult> {
      const doi =
        normalizeDoi(input.doi ?? undefined) ??
        extractDoiFromRaw(input.raw);
      if (doi) {
        const local = await papers.findByDoi(doi);
        if (local) {
          return {
            kind: "resolved",
            paperId: local.id,
            score: 1,
            reasons: ["doi_exact"],
          };
        }
      }

      const title = normalizeTitle(input.title);
      if (!title) {
        return { kind: "unresolved" };
      }

      const year = input.year ?? extractYearFromRaw(input.raw) ?? undefined;
      const rawCandidates = await papers.findCandidates({
        title,
        ...(doi ? { doi } : {}),
        ...(year !== undefined ? { year } : {}),
      });

      if (rawCandidates.length === 0) {
        return { kind: "unresolved" };
      }

      const enriched = await Promise.all(
        rawCandidates.map(async (cand) => {
          const paper = await papers.get(cand.paperId);
          return scoreCandidateAdjustments(
            cand,
            input,
            paper?.year ?? null,
            paper?.authors.map((a) => a.fullName).join(", ") ?? null,
            opts,
          );
        }),
      );

      enriched.sort((a, b) => b.score - a.score);
      const top = enriched[0];
      if (!top) return { kind: "unresolved" };

      if (top.score >= opts.strongThreshold) {
        return {
          kind: "resolved",
          paperId: top.paperId,
          score: top.score,
          reasons: top.reasons,
        };
      }
      if (top.score >= opts.weakThreshold) {
        return {
          kind: "ambiguous",
          candidates: enriched,
        };
      }
      return { kind: "unresolved" };
    },
  };
};

export const paperMatcherHelpers = {
  normalizeDoi,
  normalizeTitle,
  extractDoiFromRaw,
  extractYearFromRaw,
};
