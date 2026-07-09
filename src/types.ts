export const DEFAULT_BASE_URL = "https://tw.linovelib.com";

export interface CatalogChapter {
  title: string;
  url: string;
}

export type CatalogVolumeChapter =
  | {
      kind: "resolved";
      title: string;
      url: string;
    }
  | {
      kind: "unresolved";
      title: string;
      rawHref: string;
    };

export interface CatalogVolume {
  volumeId: string;
  title: string;
  url: string;
  coverUrl?: string;
  chapters: CatalogVolumeChapter[];
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
  content: ContentNode[];
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
  requestIntervalMs?: number;
}

export interface DownloadVolumeInput extends DownloadBookInput {
  volumeId?: string;
}

export interface DownloadChapterInput extends DownloadBookInput {
  chapterId: string;
}

export interface DownloadResult {
  bookId: string;
  pages: ChapterPage[];
}

export interface VolumeChapterResult {
  title: string;
  url: string;
  pages: ChapterPage[];
}

export interface DownloadVolumeResult {
  bookId: string;
  volume: CatalogVolume;
  chapters: VolumeChapterResult[];
}
