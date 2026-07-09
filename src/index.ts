import {
  buildCatalogUrl,
  buildChapterUrl,
  extractCatalogChapters,
  extractCatalogVolumes,
} from "./catalog.js";
import { createThrottledFetchHtml, fetchLinovelHtml } from "./http.js";
import { walkPagesFrom, shouldContinueChapter } from "./navigation.js";
import {
  DownloadBookInput,
  DownloadChapterInput,
  DownloadResult,
  DownloadVolumeInput,
  DownloadVolumeResult,
  VolumeChapterResult,
  LinovelDeps,
} from "./types.js";

export {
  buildCatalogUrl,
  buildChapterUrl,
  extractCatalogChapters,
  extractCatalogVolumes,
} from "./catalog.js";
export { formatCliHelp, parseCliOptions } from "./cli-options.js";
export { createVolumeEpubFiles, downloadEpubImageAssets, writeEpubFile } from "./epub.js";
export {
  createLinovelImageHeaders,
  createLinovelHeaders,
  createThrottledFetchBinary,
  createThrottledFetchHtml,
  fetchLinovelBinary,
  fetchLinovelHtml,
} from "./http.js";
export { walkPagesFrom, shouldContinueChapter } from "./navigation.js";
export { parseChapterPage } from "./page.js";
export type {
  CatalogChapter,
  CatalogVolume,
  CatalogVolumeChapter,
  ChapterPage,
  DownloadBookInput,
  DownloadChapterInput,
  DownloadResult,
  DownloadVolumeInput,
  DownloadVolumeResult,
  FetchHtml,
  LinovelDeps,
  ReadParams,
  VolumeChapterResult,
} from "./types.js";
export type {
  CreateVolumeEpubFilesInput,
  EpubChapterInput,
  EpubFile,
  EpubImageAsset,
  FetchEpubImage,
} from "./epub.js";

export async function downloadBook(
  input: DownloadBookInput,
  deps: Partial<LinovelDeps> = {},
): Promise<DownloadResult> {
  const fetchHtml = resolveFetchHtml(input, deps);
  const catalogUrl = buildCatalogUrl(input.bookId);
  const catalogHtml = await fetchHtml(catalogUrl);
  const chapters = extractCatalogChapters(catalogHtml, catalogUrl);

  if (chapters.length === 0) {
    throw new Error(`catalog has no chapters: ${catalogUrl}`);
  }

  return collectPages(input.bookId, chapters[0]!.url, {
    fetchHtml,
    maxPages: input.maxPages,
  });
}

export async function downloadChapter(
  input: DownloadChapterInput,
  deps: Partial<LinovelDeps> = {},
): Promise<DownloadResult> {
  const fetchHtml = resolveFetchHtml(input, deps);
  const startUrl = buildChapterUrl(input.bookId, input.chapterId);

  return collectPages(input.bookId, startUrl, {
    fetchHtml,
    maxPages: input.maxPages,
    shouldContinue: shouldContinueChapter(input.chapterId),
  });
}

export async function downloadCatalogVolumes(
  input: DownloadVolumeInput,
  deps: Partial<LinovelDeps> = {},
): Promise<DownloadVolumeResult[]> {
  const fetchHtml = resolveFetchHtml(input, deps);
  const catalogUrl = buildCatalogUrl(input.bookId);
  const catalogHtml = await fetchHtml(catalogUrl);
  const volumes = extractCatalogVolumes(catalogHtml, catalogUrl);
  const selectedVolumes = input.volumeId
    ? volumes.filter((volume) => volume.volumeId === input.volumeId)
    : volumes;

  if (selectedVolumes.length === 0) {
    throw new Error(
      input.volumeId
        ? `catalog has no volume ${input.volumeId}: ${catalogUrl}`
        : `catalog has no volumes: ${catalogUrl}`,
    );
  }

  for (const volume of selectedVolumes) {
    const unresolved = volume.chapters.filter((chapter) => chapter.kind === "unresolved");
    if (unresolved.length > 0) {
      throw new Error(
        `volume ${volume.volumeId} has unresolved catalog chapters: ${unresolved
          .map((chapter) => `${chapter.title} (${chapter.rawHref})`)
          .join(", ")}`,
      );
    }
  }

  const results: DownloadVolumeResult[] = [];
  for (const volume of selectedVolumes) {
    const chapters: VolumeChapterResult[] = [];

    for (const chapter of volume.chapters) {
      if (chapter.kind !== "resolved") {
        continue;
      }

      const chapterId = extractChapterId(chapter.url);
      if (!chapterId) {
        throw new Error(`could not extract chapter id from ${chapter.url}`);
      }

      chapters.push({
        title: chapter.title,
        url: chapter.url,
        pages: (
          await collectPages(input.bookId, chapter.url, {
            fetchHtml,
            maxPages: input.maxPages,
            shouldContinue: shouldContinueChapter(chapterId),
          })
        ).pages,
      });
    }

    results.push({ bookId: input.bookId, volume, chapters });
  }

  return results;
}

async function collectPages(
  bookId: string,
  startUrl: string,
  options: Parameters<typeof walkPagesFrom>[1],
): Promise<DownloadResult> {
  const pages = [];

  for await (const page of walkPagesFrom(startUrl, options)) {
    pages.push(page);
  }

  return { bookId, pages };
}

function extractChapterId(url: string): string {
  return /\/(\d+)(?:_\d+)?\.html(?:[?#].*)?$/.exec(url)?.[1] ?? "";
}

function resolveFetchHtml(
  input: DownloadBookInput,
  deps: Partial<LinovelDeps>,
): LinovelDeps["fetchHtml"] {
  if (deps.fetchHtml) {
    return deps.fetchHtml;
  }

  return createThrottledFetchHtml(fetchLinovelHtml, {
    intervalMs: input.requestIntervalMs ?? 250,
  });
}
