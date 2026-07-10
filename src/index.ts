import {
  buildCatalogUrl,
  buildChapterUrl,
  extractCatalogChapters,
  extractCatalogVolumes,
  extractVolumePageChapters,
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
  extractVolumePageChapters,
} from "./catalog.js";
export { formatCliHelp, parseCliOptions } from "./cli-options.js";
export {
  createVolumeEpubFiles,
  downloadEpubImageAsset,
  downloadEpubImageAssets,
  writeEpubFile,
} from "./epub.js";
export {
  createLinovelImageHeaders,
  createLinovelHeaders,
  createThrottledFetchBinary,
  createThrottledFetchHtml,
  DEFAULT_RATE_LIMIT_WAIT_MS,
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
  const results: DownloadVolumeResult[] = [];

  for await (const result of streamCatalogVolumes(input, deps)) {
    results.push(result);
  }

  return results;
}

export async function* streamCatalogVolumes(
  input: DownloadVolumeInput,
  deps: Partial<LinovelDeps> = {},
): AsyncGenerator<DownloadVolumeResult> {
  const fetchHtml = resolveFetchHtml(input, deps);
  const catalogUrl = buildCatalogUrl(input.bookId);
  const catalogHtml = await fetchHtml(catalogUrl);
  const volumes = extractCatalogVolumes(catalogHtml, catalogUrl);
  const selectedVolumes = selectCatalogVolumes(volumes, input);

  if (selectedVolumes.length === 0) {
    throw new Error(
      input.volumeId
        ? `catalog has no volume ${input.volumeId}: ${catalogUrl}`
        : input.startVolumeId
          ? `catalog has no start volume ${input.startVolumeId}: ${catalogUrl}`
          : `catalog has no volumes: ${catalogUrl}`,
    );
  }

  for (const volume of selectedVolumes) {
    const resolvedVolume = await resolveCatalogVolume(volume, fetchHtml);
    yield downloadVolumeFromEntryPoint(input.bookId, resolvedVolume, {
      fetchHtml,
      maxPages: input.maxPages,
    });
  }
}

function selectCatalogVolumes(
  volumes: DownloadVolumeResult["volume"][],
  input: DownloadVolumeInput,
): DownloadVolumeResult["volume"][] {
  if (input.volumeId) {
    return volumes.filter((volume) => volume.volumeId === input.volumeId);
  }

  if (!input.startVolumeId) {
    return volumes;
  }

  const startIndex = volumes.findIndex(
    (volume) => volume.volumeId === input.startVolumeId,
  );

  if (startIndex < 0) {
    return [];
  }

  return volumes.slice(startIndex);
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

async function resolveCatalogVolume(
  volume: DownloadVolumeResult["volume"],
  fetchHtml: LinovelDeps["fetchHtml"],
): Promise<DownloadVolumeResult["volume"]> {
  if (volume.chapters.some((chapter) => chapter.kind === "unresolved")) {
    const volumeHtml = await fetchHtml(volume.url);
    const volumePageChapters = extractVolumePageChapters(
      volumeHtml,
      volume.url,
    );
    if (volumePageChapters.length > 0) {
      volume.chapters = volumePageChapters;
    }
  }

  const unresolved = volume.chapters.filter(
    (chapter) => chapter.kind === "unresolved",
  );
  if (unresolved.length > 0) {
    throw new Error(
      `volume ${volume.volumeId} has unresolved catalog chapters: ${unresolved
        .map((chapter) => `${chapter.title} (${chapter.rawHref})`)
        .join(", ")}`,
    );
  }

  return volume;
}

async function downloadVolumeFromEntryPoint(
  bookId: string,
  volume: DownloadVolumeResult["volume"],
  options: Parameters<typeof walkPagesFrom>[1],
): Promise<DownloadVolumeResult> {
  const resolvedChapters = volume.chapters.filter(
    (chapter): chapter is Extract<typeof chapter, { kind: "resolved" }> =>
      chapter.kind === "resolved",
  );

  if (resolvedChapters.length === 0) {
    return { bookId, volume, chapters: [] };
  }

  const chapterMetaById = new Map(
    resolvedChapters.map((chapter) => [extractChapterId(chapter.url), chapter]),
  );
  const firstChapter = resolvedChapters[0]!;
  const lastChapter = resolvedChapters.at(-1)!;
  const lastChapterId = extractChapterId(lastChapter.url);

  if (!lastChapterId) {
    throw new Error(`could not extract chapter id from ${lastChapter.url}`);
  }

  const chapters: Array<VolumeChapterResult & { chapterId: string }> = [];
  let currentChapter: (VolumeChapterResult & { chapterId: string }) | null =
    null;

  for await (const page of walkPagesFrom(firstChapter.url, {
    ...options,
    shouldContinue: shouldContinueThroughChapter(lastChapterId),
  })) {
    const chapterId = page.readParams.chapterid;
    if (!chapterId) {
      throw new Error(`missing chapter id in page ${page.url}`);
    }

    const chapterMeta = chapterMetaById.get(chapterId);

    if (!currentChapter || currentChapter.chapterId !== chapterId) {
      if (currentChapter) {
        chapters.push(currentChapter);
      }

      currentChapter = {
        chapterId,
        title: chapterMeta?.title ?? page.title,
        url: chapterMeta?.url ?? page.url,
        pages: [page],
      };
      continue;
    }

    currentChapter.pages.push(page);
  }

  if (currentChapter) {
    chapters.push(currentChapter);
  }

  return {
    bookId,
    volume,
    chapters: chapters.map(({ chapterId: _chapterId, ...chapter }) => chapter),
  };
}

function shouldContinueThroughChapter(
  lastChapterId: string,
): (page: Parameters<ReturnType<typeof shouldContinueChapter>>[0]) => boolean {
  const shouldContinueLastChapter = shouldContinueChapter(lastChapterId);

  return (page) => {
    if (page.readParams.chapterid !== lastChapterId) {
      return true;
    }

    return shouldContinueLastChapter(page);
  };
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
