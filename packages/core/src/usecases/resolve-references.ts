import type {
  JobSpec,
  Paper,
  PaperId,
  PaperMatchInput,
  ReferenceRecord,
  ResolvedReference,
} from "../domain/index.js";
import type { ReferenceResolutionUpdate } from "../ports/index.js";
import type { Deps } from "./types.js";
import { detectLang } from "../services/lang.js";

export type ResolveReferencesInput = {
  paperId: PaperId;
  /** Force re-resolution of already resolved references. Default false. */
  force?: boolean;
};

export type ResolveReferencesOutput = {
  paperId: PaperId;
  scanned: number;
  resolved: number;
  ghostsCreated: number;
  ambiguous: number;
  unresolved: number;
  skipped: number;
  followUp: JobSpec[];
};

const buildMatchInput = (ref: ReferenceRecord): PaperMatchInput => ({
  raw: ref.raw,
  doi: ref.doi,
  title: ref.title,
  authorsHint: ref.authorsHint,
  year: ref.year,
});

const findLocalByCanonical = async (
  deps: Deps,
  resolved: ResolvedReference,
): Promise<Paper | null> => {
  if (resolved.doi) {
    const byDoi = await deps.papers.findByDoi(resolved.doi);
    if (byDoi) return byDoi;
  }
  if (resolved.openalexId) {
    const candidates = await deps.papers.findCandidates({
      title: resolved.title,
      ...(resolved.year != null ? { year: resolved.year } : {}),
    });
    if (candidates.length === 1 && candidates[0]!.score >= 0.9) {
      return deps.papers.get(candidates[0]!.paperId);
    }
  }
  return null;
};

const createGhostPaper = async (
  deps: Deps,
  resolved: ResolvedReference,
): Promise<PaperId> => {
  const now = deps.clock.now();
  const paperId = deps.idGen.newId("pap") as PaperId;
  const lang = detectLang(resolved.title);
  const paper: Paper = {
    id: paperId,
    doi: resolved.doi,
    openalexId: resolved.openalexId,
    title: resolved.title,
    titleJa: null,
    authors: resolved.authors.map((fullName) => ({ fullName })),
    year: resolved.year,
    venue: resolved.venue,
    lang,
    status: "ghost",
    currentFileId: null,
    source: "biblio_resolver",
    createdAt: now,
    updatedAt: now,
  };
  await deps.papers.upsert(paper);
  return paperId;
};

export const resolveReferences = async (
  deps: Deps,
  input: ResolveReferencesInput,
): Promise<ResolveReferencesOutput> => {
  const { citations, matcher } = deps;
  if (!citations) {
    return {
      paperId: input.paperId,
      scanned: 0,
      resolved: 0,
      ghostsCreated: 0,
      ambiguous: 0,
      unresolved: 0,
      skipped: 0,
      followUp: [],
    };
  }

  const refs = await citations.listReferencesForPaper(input.paperId);
  const force = input.force ?? false;

  let resolved = 0;
  let ghostsCreated = 0;
  let ambiguous = 0;
  let unresolved = 0;
  let skipped = 0;

  for (const ref of refs) {
    if (!force && (ref.resolveState === "resolved" || ref.resolveState === "manual")) {
      skipped += 1;
      continue;
    }

    const update = await resolveOne(deps, ref);
    if (update.reason === "ghost") ghostsCreated += 1;

    await citations.updateReferenceResolution(ref.id, update.patch);

    switch (update.patch.resolveState) {
      case "resolved":
        resolved += 1;
        break;
      case "ambiguous":
        ambiguous += 1;
        break;
      case "unresolved":
        unresolved += 1;
        break;
      case "manual":
        skipped += 1;
        break;
    }
  }

  const followUp: JobSpec[] = [];
  if (resolved > 0 || ghostsCreated > 0) {
    followUp.push({
      kind: "build_citation_edges",
      lane: "resolve",
      payload: { paperId: input.paperId },
      idempotencyKey: `build_edges:${input.paperId}:${matcher?.version ?? "no-matcher"}:${deps.biblio?.version ?? "no-biblio"}`,
    });
  }

  return {
    paperId: input.paperId,
    scanned: refs.length,
    resolved,
    ghostsCreated,
    ambiguous,
    unresolved,
    skipped,
    followUp,
  };
};

type ResolveOneOutcome = {
  patch: ReferenceResolutionUpdate;
  reason: "doi_local" | "matcher_resolved" | "matcher_ambiguous" | "biblio_local" | "ghost" | "unresolved";
};

const patchFromEnrichment = (
  resolved: ResolvedReference,
): Pick<ReferenceResolutionUpdate, "doi" | "title" | "authorsHint" | "year"> => ({
  doi: resolved.doi,
  title: resolved.title,
  authorsHint:
    resolved.authors.length > 0 ? resolved.authors.join(", ") : null,
  year: resolved.year,
});

const resolveOne = async (
  deps: Deps,
  ref: ReferenceRecord,
): Promise<ResolveOneOutcome> => {
  const { matcher, biblio, papers } = deps;
  const resolverVersion =
    [matcher?.version, biblio?.version].filter(Boolean).join("+") || null;

  if (ref.doi) {
    const local = await papers.findByDoi(ref.doi);
    if (local) {
      return {
        patch: {
          resolvedPaperId: local.id,
          resolveState: "resolved",
          resolveScore: 1,
          resolverVersion,
        },
        reason: "doi_local",
      };
    }
  }

  if (matcher) {
    const result = await matcher.match(buildMatchInput(ref));
    if (result.kind === "resolved") {
      return {
        patch: {
          resolvedPaperId: result.paperId,
          resolveState: "resolved",
          resolveScore: result.score,
          resolverVersion,
        },
        reason: "matcher_resolved",
      };
    }
    if (result.kind === "ambiguous") {
      const top = result.candidates[0] ?? null;
      return {
        patch: {
          resolvedPaperId: null,
          resolveState: "ambiguous",
          resolveScore: top?.score ?? null,
          resolverVersion,
        },
        reason: "matcher_ambiguous",
      };
    }
  }

  if (!biblio) {
    return {
      patch: {
        resolvedPaperId: null,
        resolveState: "unresolved",
        resolveScore: null,
        resolverVersion,
      },
      reason: "unresolved",
    };
  }

  const canonical = await biblio.resolve(ref.raw);
  if (!canonical) {
    return {
      patch: {
        resolvedPaperId: null,
        resolveState: "unresolved",
        resolveScore: null,
        resolverVersion,
      },
      reason: "unresolved",
    };
  }

  const local = await findLocalByCanonical(deps, canonical);
  if (local) {
    return {
      patch: {
        resolvedPaperId: local.id,
        resolveState: "resolved",
        resolveScore: 0.95,
        resolverVersion,
        ...patchFromEnrichment(canonical),
      },
      reason: "biblio_local",
    };
  }

  const ghostId = await createGhostPaper(deps, canonical);
  return {
    patch: {
      resolvedPaperId: ghostId,
      resolveState: "resolved",
      resolveScore: 0.9,
      resolverVersion,
      ...patchFromEnrichment(canonical),
    },
    reason: "ghost",
  };
};
