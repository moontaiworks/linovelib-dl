import { absolutizeUrl, cleanText, matchFirst } from "./html.js";
import { CatalogChapter, DEFAULT_BASE_URL } from "./types.js";

export function buildCatalogUrl(bookId: string, baseUrl = DEFAULT_BASE_URL): string {
  return absolutizeUrl(`/novel/${bookId}/catalog`, baseUrl);
}

export function buildChapterUrl(bookId: string, chapterId: string, baseUrl = DEFAULT_BASE_URL): string {
  return absolutizeUrl(`/novel/${bookId}/${chapterId}.html`, baseUrl);
}

export function extractCatalogChapters(html: string, catalogUrl: string): CatalogChapter[] {
  const chapters: CatalogChapter[] = [];
  const chapterPattern = /<li\b[^>]*class=["'][^"']*\bjsChapter\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;

  for (const match of html.matchAll(chapterPattern)) {
    const itemHtml = match[1] ?? "";
    const href = matchFirst(itemHtml, /<a\b[^>]*href=["']([^"']+)["']/i);
    const title =
      matchFirst(itemHtml, /<span\b[^>]*class=["'][^"']*\bchapter-index\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      itemHtml;

    if (!href) {
      continue;
    }

    chapters.push({
      title: cleanText(title),
      url: absolutizeUrl(href, catalogUrl),
    });
  }

  return chapters;
}
