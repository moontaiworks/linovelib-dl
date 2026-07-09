import { buildCatalogUrl, buildChapterUrl, extractCatalogChapters } from "./catalog.js";
import { fetchLinovelHtml } from "./http.js";
import { walkPagesFrom, shouldContinueChapter } from "./navigation.js";
import {
  DownloadBookInput,
  DownloadChapterInput,
  DownloadResult,
  LinovelDeps,
} from "./types.js";

export { buildCatalogUrl, buildChapterUrl, extractCatalogChapters } from "./catalog.js";
export { createLinovelHeaders, fetchLinovelHtml } from "./http.js";
export { walkPagesFrom, shouldContinueChapter } from "./navigation.js";
export { parseChapterPage } from "./page.js";
export type {
  CatalogChapter,
  ChapterPage,
  DownloadBookInput,
  DownloadChapterInput,
  DownloadResult,
  FetchHtml,
  LinovelDeps,
  ReadParams,
} from "./types.js";

export async function downloadBook(
  input: DownloadBookInput,
  deps: Partial<LinovelDeps> = {},
): Promise<DownloadResult> {
  const fetchHtml = deps.fetchHtml ?? fetchLinovelHtml;
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
  const fetchHtml = deps.fetchHtml ?? fetchLinovelHtml;
  const startUrl = buildChapterUrl(input.bookId, input.chapterId);

  return collectPages(input.bookId, startUrl, {
    fetchHtml,
    maxPages: input.maxPages,
    shouldContinue: shouldContinueChapter(input.chapterId),
  });
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
