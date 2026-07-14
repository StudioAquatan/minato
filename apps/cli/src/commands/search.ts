import { hybridSearch, type SearchHit } from "@minato/core";
import type { CliRuntime } from "../bootstrap.js";

type PaperGroup = {
  paperId: string;
  title: string;
  authors: string[];
  year: number | null;
  lang: string;
  topScore: number;
  hits: SearchHit[];
};

const groupByPaper = (hits: SearchHit[]): PaperGroup[] => {
  const map = new Map<string, PaperGroup>();
  for (const h of hits) {
    const existing = map.get(h.paperId);
    if (existing) {
      existing.hits.push(h);
      if (h.score > existing.topScore) existing.topScore = h.score;
    } else {
      map.set(h.paperId, {
        paperId: h.paperId,
        title: h.title,
        authors: h.authors,
        year: h.year,
        lang: h.lang,
        topScore: h.score,
        hits: [h],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.topScore - a.topScore);
};

export const searchCommand = async (
  runtime: CliRuntime,
  args: {
    query: string;
    limit?: number;
    lang?: string;
    yearFrom?: number;
    yearTo?: number;
    semanticRatio?: number;
    chunksPerPaper?: number;
  },
): Promise<void> => {
  const filters =
    args.lang || args.yearFrom || args.yearTo
      ? {
          ...(args.lang ? { lang: [args.lang] } : {}),
          ...(args.yearFrom ? { yearFrom: args.yearFrom } : {}),
          ...(args.yearTo ? { yearTo: args.yearTo } : {}),
        }
      : undefined;

  const paperLimit = args.limit ?? 10;
  const chunksPerPaper = Math.max(1, args.chunksPerPaper ?? 2);
  const fetchLimit = Math.max(paperLimit * 5, paperLimit + 20);

  const input: Parameters<typeof hybridSearch>[1] = {
    query: args.query,
    limit: fetchLimit,
    semanticRatio: args.semanticRatio ?? 0.5,
  };
  if (filters) input.filters = filters;
  const hits = await hybridSearch(runtime.deps, input);

  if (hits.length === 0) {
    console.log("(no hits)");
    return;
  }
  const groups = groupByPaper(hits).slice(0, paperLimit);
  for (const g of groups) {
    const authors = g.authors.slice(0, 3).join(", ");
    const more = g.authors.length > 3 ? ` +${g.authors.length - 3}` : "";
    console.log(
      `- [${g.topScore.toFixed(3)}] ${g.title} (${g.year ?? "?"})`,
    );
    console.log(
      `    paper=${g.paperId} lang=${g.lang} chunks=${g.hits.length}`,
    );
    if (authors) console.log(`    authors: ${authors}${more}`);
    for (const h of g.hits.slice(0, chunksPerPaper)) {
      console.log(
        `    · [${h.score.toFixed(3)}] p.${h.pageFrom}-${h.pageTo} ${h.snippet.replaceAll("\n", " ")}`,
      );
    }
    if (g.hits.length > chunksPerPaper) {
      console.log(`    · … +${g.hits.length - chunksPerPaper} more chunk(s)`);
    }
  }
};
