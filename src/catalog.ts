import * as cheerio from "cheerio";
import { absolutizeUrl } from "./html.js";
import { CatalogChapter, DEFAULT_BASE_URL } from "./types.js";

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

function normalizeDomText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}
