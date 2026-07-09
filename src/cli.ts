#!/usr/bin/env node
import { downloadBook, downloadChapter } from "./index.js";
import { formatCliHelp, parseCliOptions } from "./cli-options.js";

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);

  if (options.command === "help") {
    process.stdout.write(`${formatCliHelp()}\n`);
    return;
  }

  const result = options.chapterId
    ? await downloadChapter({
        bookId: options.bookId,
        chapterId: options.chapterId,
        maxPages: options.maxPages,
        requestIntervalMs: options.requestIntervalMs,
      })
    : await downloadBook({
        bookId: options.bookId,
        maxPages: options.maxPages,
        requestIntervalMs: options.requestIntervalMs,
      });

  process.stdout.write(`${JSON.stringify(result, null, 0)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
