export const DEFAULT_BASE_URL = "https://tw.linovelib.com";

export interface CatalogChapter {
  title: string;
  url: string;
}

export interface ContentNode {
  type: "p" | "center" | "img" | "br";
  raw: string;
  text?: string;
  src?: string;
}

export interface ReadParams {
  url_previous?: string;
  url_next?: string;
  url_index?: string;
  url_articleinfo?: string;
  url_image?: string;
  url_home?: string;
  articleid?: string;
  articlename?: string;
  subid?: string;
  author?: string;
  chapterid?: string;
  page?: string;
  chaptername?: string;
  chapterisvip?: string;
  userid?: string;
  readtime?: string;
  [key: string]: string | undefined;
}

export interface ChapterPage {
  url: string;
  title: string;
  volumeTitle: string;
  readParams: ReadParams;
  previousUrl: string | null;
  nextUrl: string | null;
  indexUrl: string | null;
  nextLinkLabel: string;
  lines: string[];
  text: string;
}

export type FetchHtml = (url: string) => Promise<string>;

export interface LinovelDeps {
  fetchHtml: FetchHtml;
}

export interface WalkPagesOptions {
  fetchHtml: FetchHtml;
  maxPages?: number;
  shouldContinue?: (page: ChapterPage) => boolean;
}

export interface DownloadBookInput {
  bookId: string;
  maxPages?: number;
}

export interface DownloadChapterInput extends DownloadBookInput {
  chapterId: string;
}

export interface DownloadResult {
  bookId: string;
  pages: ChapterPage[];
}
