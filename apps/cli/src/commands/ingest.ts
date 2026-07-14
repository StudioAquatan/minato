import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";
import { registerFile } from "@minato/core";
import type { CliRuntime } from "../bootstrap.js";

const collectPdfPaths = async (root: string): Promise<string[]> => {
  const abs = resolve(root);
  const s = await fs.stat(abs);
  if (s.isFile()) {
    return extname(abs).toLowerCase() === ".pdf" ? [abs] : [];
  }
  const out: string[] = [];
  const entries = await fs.readdir(abs, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...(await collectPdfPaths(`${abs}/${e.name}`)));
    } else if (extname(e.name).toLowerCase() === ".pdf") {
      out.push(`${abs}/${e.name}`);
    }
  }
  return out;
};

export const ingestCommand = async (
  runtime: CliRuntime,
  args: { path: string; source?: string },
): Promise<void> => {
  const files = await collectPdfPaths(args.path);
  if (files.length === 0) {
    console.log(`no PDFs found under ${args.path}`);
    return;
  }
  console.log(`registering ${files.length} PDF(s)`);
  let ok = 0;
  let dup = 0;
  for (const path of files) {
    const opts: { sourcePath: string; source?: string } = { sourcePath: path };
    if (args.source !== undefined) opts.source = args.source;
    const res = await registerFile(runtime.deps, opts);
    if (res.isDuplicate) dup += 1;
    else ok += 1;
    console.log(
      `  ${res.isDuplicate ? "dup" : "new"} sha=${res.sha256.slice(0, 12)} jobId=${res.enqueuedJobId ?? "-"} path=${path}`,
    );
  }
  console.log(`done. new=${ok} duplicate=${dup}`);
};
