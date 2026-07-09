#!/usr/bin/env node
import { join } from "node:path";
import {
  createThrottledFetchBinary,
  createVolumeEpubFiles,
  downloadBook,
  downloadEpubImageAssets,
  downloadChapter,
  fetchLinovelBinary,
  streamCatalogVolumes,
  writeEpubFile,
} from "./index.js";
import { formatCliHelp, parseCliOptions } from "./cli-options.js";

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);

  if (options.command === "help") {
    process.stdout.write(`${formatCliHelp()}\n`);
    return;
  }

  if (options.format === "epub") {
    const output = options.output;
    if (!output) {
      throw new Error("--output is required when --format epub");
    }

    const fetchImage = createThrottledFetchBinary(fetchLinovelBinary, {
      intervalMs: options.requestIntervalMs,
    });

    const written = [];
    for await (const result of streamCatalogVolumes({
      bookId: options.bookId,
      volumeId: options.volumeId,
      startVolumeId: options.startVolumeId,
      maxPages: options.maxPages,
      requestIntervalMs: options.requestIntervalMs,
    })) {
      const identifier = `linovelib-${options.bookId}-${result.volume.volumeId}`;
      const chapters = result.chapters.map((chapter) => ({
        title: chapter.title,
        pages: chapter.pages,
      }));
      const imageAssets = await downloadEpubImageAssets(chapters, fetchImage);
      const files = createVolumeEpubFiles({
        bookId: options.bookId,
        title: result.volume.title,
        identifier,
        chapters,
        imageAssets,
      });
      const fileName = formatEpubFileName(
        written.length + 1,
        options.bookId,
        result.volume.volumeId,
        result.volume.title,
      );
      const outputPath = join(output, fileName);

      await writeEpubFile(files, outputPath);
      written.push({
        volumeId: result.volume.volumeId,
        title: result.volume.title,
        path: outputPath,
      });
    }

    process.stdout.write(
      `${JSON.stringify({ bookId: options.bookId, files: written }, null, 0)}\n`,
    );
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

export function formatEpubFileName(
  index: number,
  bookId: string,
  volumeId: string,
  title: string,
): string {
  return `${String(index).padStart(3, "0")} ${safeFileName(title)} ${bookId}-${volumeId}.epub`;
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
