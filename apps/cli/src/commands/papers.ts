import type { CliRuntime } from "../bootstrap.js";

export const papersListCommand = async (
  runtime: CliRuntime,
  args: { limit?: number; offset?: number },
): Promise<void> => {
  const limit = args.limit ?? 50;
  const offset = args.offset ?? 0;
  const rows = await runtime.deps.papers.listAll(limit, offset);
  if (rows.length === 0) {
    console.log("(no papers)");
    return;
  }
  for (const p of rows) {
    const authors = p.authors
      .slice(0, 3)
      .map((a) => a.fullName)
      .join(", ");
    const more = p.authors.length > 3 ? ` +${p.authors.length - 3}` : "";
    console.log(
      `- ${p.id} [${p.status}] ${p.title} (${p.year ?? "?"})`,
    );
    console.log(
      `    authors: ${authors}${more}`,
    );
    const meta: string[] = [`lang=${p.lang}`];
    if (p.venue) meta.push(`venue=${p.venue}`);
    if (p.doi) meta.push(`doi=${p.doi}`);
    if (p.source) meta.push(`source=${p.source}`);
    console.log(`    ${meta.join(" ")}`);
  }
  console.log(`(${rows.length} paper(s), offset=${offset})`);
};
