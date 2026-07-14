import { hybridSearch } from "@minato/core";
import type { CliRuntime } from "../bootstrap.js";

export const searchCommand = async (
  runtime: CliRuntime,
  args: {
    query: string;
    limit?: number;
    lang?: string;
    yearFrom?: number;
    yearTo?: number;
    semanticRatio?: number;
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

  const input: Parameters<typeof hybridSearch>[1] = {
    query: args.query,
    limit: args.limit ?? 10,
    semanticRatio: args.semanticRatio ?? 0.5,
  };
  if (filters) input.filters = filters;
  const hits = await hybridSearch(runtime.deps, input);

  if (hits.length === 0) {
    console.log("(no hits)");
    return;
  }
  for (const h of hits) {
    console.log(
      `- [${h.score.toFixed(3)}] ${h.title} (${h.year ?? "?"}) p.${h.pageFrom}-${h.pageTo}`,
    );
    console.log(`    paper=${h.paperId} chunk=${h.chunkId} lang=${h.lang}`);
    console.log(`    ${h.snippet.replaceAll("\n", " ")}`);
  }
};
