import * as cheerio from "cheerio";
import { absolutizeUrl } from "./html.js";
import {
  CatalogChapter,
  CatalogVolume,
  DEFAULT_BASE_URL,
} from "./types.js";

export function buildCatalogUrl(bookId: string, baseUrl = DEFAULT_BASE_URL): string {
  return absolutizeUrl(`/novel/${bookId}/catalog`, baseUrl);
}

export function buildChapterUrl(bookId: string, chapterId: string, baseUrl = DEFAULT_BASE_URL): string {
  return absolutizeUrl(`/novel/${bookId}/${chapterId}.html`, baseUrl);
}

export function extractCatalogChapters(html: string, catalogUrl: string): CatalogChapter[] {
  const $ = cheerio.load(html);
  const chapters: CatalogChapter[] = [];

  $(".jsChapter").each((_, element) => {
    const item = $(element);
    const link = item.children("a").first();
    const href = link.attr("href");

    if (!href) {
      return;
    }

    const titleNode = link.find(".chapter-index").first();
    const title = titleNode.length > 0 ? titleNode.text() : link.text();

    chapters.push({
      title: normalizeDomText(title),
      url: absolutizeUrl(href, catalogUrl),
    });
  });

  return chapters;
}

export function extractCatalogVolumes(html: string, catalogUrl: string): CatalogVolume[] {
  const $ = cheerio.load(html);
  const volumes: CatalogVolume[] = [];

  $(".catalog-volume").each((_, element) => {
    const volume = $(element);
    const headerLink = volume.find(".chapter-bar a").first();
    const href = headerLink.attr("href");

    if (!href) {
      return;
    }

    const url = absolutizeUrl(href, catalogUrl);
    const volumeId = extractVolumeId(url);
    if (!volumeId) {
      return;
    }

    const coverImage = volume.find(".volume-cover-img img").first();
    const coverHref = coverImage.attr("data-src") ?? coverImage.attr("src");
    const coverUrl = coverHref ? absolutizeUrl(coverHref, catalogUrl) : undefined;
    const catalogVolume: CatalogVolume = {
      volumeId,
      title: normalizeDomText(headerLink.find("h3").first().text() || headerLink.text()),
      url,
      chapters: [],
    };

    if (coverUrl) {
      catalogVolume.coverUrl = coverUrl;
    }

    volume.find(".jsChapter").each((_, chapterElement) => {
      const item = $(chapterElement);
      const link = item.children("a").first();
      const chapterHref = link.attr("href");

      if (!chapterHref) {
        return;
      }

      const titleNode = link.find(".chapter-index").first();
      const title = normalizeDomText(titleNode.length > 0 ? titleNode.text() : link.text());

      if (isResolvableCatalogHref(chapterHref)) {
        catalogVolume.chapters.push({
          kind: "resolved",
          title,
          url: absolutizeUrl(chapterHref, catalogUrl),
        });
        return;
      }

      catalogVolume.chapters.push({
        kind: "unresolved",
        title,
        rawHref: chapterHref,
      });
    });

    volumes.push(catalogVolume);
  });

  return volumes;
}

function extractVolumeId(url: string): string {
  return /\/vol_(\d+)\.html(?:[?#].*)?$/.exec(url)?.[1] ?? "";
}

function isResolvableCatalogHref(href: string): boolean {
  return href.startsWith("/") || /^https?:\/\//i.test(href);
}

function normalizeDomText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}
