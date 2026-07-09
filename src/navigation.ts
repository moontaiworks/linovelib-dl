import { parseChapterPage } from "./page.js";
import { ChapterPage, WalkPagesOptions } from "./types.js";

export async function* walkPagesFrom(
  startUrl: string,
  options: WalkPagesOptions,
): AsyncGenerator<ChapterPage> {
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const visited = new Set<string>();
  let currentUrl: string | null = startUrl;

  for (let count = 0; currentUrl && count < maxPages; count++) {
    if (visited.has(currentUrl)) {
      throw new Error(`detected chapter navigation loop at ${currentUrl}`);
    }

    visited.add(currentUrl);
    const html = await options.fetchHtml(currentUrl);
    if (typeof html !== "string") {
      throw new Error(`fetchHtml did not return HTML for ${currentUrl}`);
    }

    const page = parseChapterPage(html, currentUrl);
    yield page;

    if (options.shouldContinue && !options.shouldContinue(page)) {
      return;
    }

    currentUrl = page.nextUrl;
  }
}

export function shouldContinueChapter(
  chapterId: string,
): (page: ChapterPage) => boolean {
  return (page) => {
    if (page.readParams.chapterid !== chapterId) {
      return false;
    }

    if (page.nextUrl && page.indexUrl && page.nextUrl === page.indexUrl) {
      return false;
    }

    return page.nextLinkLabel !== "下一章";
  };
}
