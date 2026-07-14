import { bootstrapCli } from "./bootstrap.js";
import { ingestCommand } from "./commands/ingest.js";
import { searchCommand } from "./commands/search.js";
import { reindexCommand } from "./commands/reindex.js";
import { migrateCommand } from "./commands/migrate.js";

type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | true>;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
};

const usage = () => {
  console.log(`minato CLI

Usage:
  minato migrate
  minato ingest <path> [--source name]
  minato search "<query>" [--limit N] [--lang ja|en] [--year-from Y] [--year-to Y] [--semantic-ratio 0.5]
  minato reindex
`);
};

const num = (v: string | true | undefined): number | undefined => {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const str = (v: string | true | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args.positional;
  if (!cmd) {
    usage();
    process.exit(0);
  }
  if (cmd === "migrate") {
    await migrateCommand();
    return;
  }
  const runtime = await bootstrapCli();
  try {
    switch (cmd) {
      case "ingest": {
        const path = rest[0];
        if (!path) throw new Error("ingest requires a path");
        const opts: Parameters<typeof ingestCommand>[1] = { path };
        const source = str(args.flags["source"]);
        if (source !== undefined) opts.source = source;
        await ingestCommand(runtime, opts);
        break;
      }
      case "search": {
        const query = rest.join(" ").trim();
        if (!query) throw new Error("search requires a query");
        const opts: Parameters<typeof searchCommand>[1] = { query };
        const limit = num(args.flags["limit"]);
        if (limit !== undefined) opts.limit = limit;
        const lang = str(args.flags["lang"]);
        if (lang !== undefined) opts.lang = lang;
        const yearFrom = num(args.flags["year-from"]);
        if (yearFrom !== undefined) opts.yearFrom = yearFrom;
        const yearTo = num(args.flags["year-to"]);
        if (yearTo !== undefined) opts.yearTo = yearTo;
        const semanticRatio = num(args.flags["semantic-ratio"]);
        if (semanticRatio !== undefined) opts.semanticRatio = semanticRatio;
        await searchCommand(runtime, opts);
        break;
      }
      case "reindex": {
        await reindexCommand(runtime);
        break;
      }
      default:
        usage();
        process.exit(2);
    }
  } finally {
    await runtime.close();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
