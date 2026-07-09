import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import yazl from "yazl";
import { ChapterPage, ContentNode } from "./types.js";

export interface EpubChapterInput {
  title: string;
  pages: ChapterPage[];
}

export interface CreateVolumeEpubFilesInput {
  bookId: string;
  title: string;
  identifier: string;
  author?: string;
  language?: string;
  chapters: EpubChapterInput[];
  imageAssets?: EpubImageAsset[];
}

export interface EpubFile {
  path: string;
  content: string | Buffer;
  compression?: "store" | "compress";
}

export interface EpubImageAsset {
  sourceUrl: string;
  mediaType: string;
  content: Buffer;
}

export type FetchEpubImage = (url: string) => Promise<{
  content: Buffer;
  mediaType?: string;
}>;

export async function downloadEpubImageAssets(
  chapters: EpubChapterInput[],
  fetchImage: FetchEpubImage,
): Promise<EpubImageAsset[]> {
  const urls = collectImageUrls(chapters);
  const assets: EpubImageAsset[] = [];

  for (const url of urls) {
    try {
      const result = await fetchImage(url);
      assets.push({
        sourceUrl: url,
        mediaType: result.mediaType ?? inferMediaTypeFromUrl(url),
        content: result.content,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping image asset ${url}: ${message}`);
    }
  }

  return assets;
}

export function createVolumeEpubFiles(
  input: CreateVolumeEpubFilesInput,
): EpubFile[] {
  const chapters = input.chapters.map((chapter, index) => ({
    ...chapter,
    id: `chapter-${String(index + 1).padStart(3, "0")}`,
    href: `chapters/chapter-${String(index + 1).padStart(3, "0")}.xhtml`,
  }));
  const images = createImageEntries(input.imageAssets ?? []);

  return [
    {
      path: "mimetype",
      content: "application/epub+zip",
      compression: "store",
    },
    {
      path: "META-INF/container.xml",
      content: renderContainerXml(),
    },
    {
      path: "OEBPS/content.opf",
      content: renderContentOpf(input, chapters, images),
    },
    {
      path: "OEBPS/nav.xhtml",
      content: renderNavXhtml(input.title, chapters),
    },
    {
      path: "OEBPS/toc.ncx",
      content: renderTocNcx(input, chapters),
    },
    ...chapters.map((chapter) => ({
      path: `OEBPS/${chapter.href}`,
      content: renderChapterXhtml(
        input.title,
        chapter.title,
        chapter.pages,
        images,
      ),
    })),
    ...images.map((image) => ({
      path: `OEBPS/${image.href}`,
      content: image.content,
    })),
  ];
}

export async function writeEpubFile(
  files: EpubFile[],
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const zip = new yazl.ZipFile();
  for (const file of files) {
    zip.addBuffer(Buffer.from(file.content), file.path, {
      compress: file.compression !== "store",
    });
  }

  zip.end();

  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(outputPath))
      .on("close", resolve)
      .on("error", reject);
    zip.outputStream.on("error", reject);
  });
}

function renderContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function renderContentOpf(
  input: CreateVolumeEpubFilesInput,
  chapters: Array<EpubChapterInput & { id: string; href: string }>,
  images: EpubImageEntry[],
): string {
  const language = input.language ?? "zh-TW";
  const author = input.author ?? "Linovelib";
  const chapterManifest = chapters
    .map(
      (chapter) =>
        `    <item id="${chapter.id}" href="${xmlAttr(chapter.href)}" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spine = chapters
    .map((chapter) => `    <itemref idref="${chapter.id}"/>`)
    .join("\n");
  const imageManifest = images
    .map(
      (image) =>
        `    <item id="${image.id}" href="${xmlAttr(image.href)}" media-type="${xmlAttr(
          image.mediaType,
        )}"/>`,
    )
    .join("\n");
  const manifestItems = [chapterManifest, imageManifest]
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${xmlText(input.identifier)}</dc:identifier>
    <dc:title>${xmlText(input.title)}</dc:title>
    <dc:creator>${xmlText(author)}</dc:creator>
    <dc:language>${xmlText(language)}</dc:language>
    <meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}
  </manifest>
  <spine toc="toc">
${spine}
  </spine>
</package>
`;
}

function renderNavXhtml(
  title: string,
  chapters: Array<EpubChapterInput & { href: string }>,
): string {
  const items = chapters
    .map(
      (chapter) =>
        `      <li><a href="${xmlAttr(chapter.href)}">${xmlText(chapter.title)}</a></li>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW">
  <head>
    <title>${xmlText(title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${xmlText(title)}</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function renderTocNcx(
  input: CreateVolumeEpubFilesInput,
  chapters: Array<EpubChapterInput & { id: string; href: string }>,
): string {
  const navPoints = chapters
    .map(
      (
        chapter,
        index,
      ) => `    <navPoint id="${chapter.id}" playOrder="${index + 1}">
      <navLabel><text>${xmlText(chapter.title)}</text></navLabel>
      <content src="${xmlAttr(chapter.href)}"/>
    </navPoint>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlAttr(input.identifier)}"/>
  </head>
  <docTitle><text>${xmlText(input.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function renderChapterXhtml(
  volumeTitle: string,
  chapterTitle: string,
  pages: ChapterPage[],
  images: EpubImageEntry[],
): string {
  const imageBySourceUrl = new Map(
    images.map((image) => [image.sourceUrl, image]),
  );
  const paragraphs = pages
    .flatMap((page) => page.content)
    .map((node) => renderContentNode(node, imageBySourceUrl))
    .filter((line) => line.length > 0)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-TW">
  <head>
    <title>${xmlText(chapterTitle)}</title>
    <style>
      br { display: block; margin: 1em 0; content: ""; }
    </style>
  </head>
  <body>
    <section>
      <h1>${xmlText(chapterTitle)}</h1>
      <p class="volume-title">${xmlText(volumeTitle)}</p>
${paragraphs}
    </section>
  </body>
</html>
`;
}

function renderContentNode(
  node: ContentNode,
  imageBySourceUrl: Map<string, EpubImageEntry>,
): string {
  if (node.type === "br") {
    return "      <br />";
  }

  if (node.type === "img" && node.src) {
    const image = imageBySourceUrl.get(node.src);
    if (image) {
      return `      <p><img src="../${xmlAttr(image.href)}" alt="${xmlAttr(node.src)}"/></p>`;
    }

    return `      <p>照片載入失敗</p>\n      <p><a href="${xmlAttr(node.src)}">${xmlText(node.src)}</a></p>`;
  }

  if ((node.type === "p" || node.type === "center") && node.text) {
    return `      <p>${xmlText(node.text.trim())}</p>`;
  }

  return "";
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlAttr(value: string): string {
  return xmlText(value).replace(/"/g, "&quot;");
}

function collectImageUrls(chapters: EpubChapterInput[]): string[] {
  const urls = new Set<string>();

  for (const chapter of chapters) {
    for (const page of chapter.pages) {
      for (const node of page.content) {
        if (node.type === "img" && node.src) {
          urls.add(node.src);
        }
      }
    }
  }

  return [...urls];
}

interface EpubImageEntry extends EpubImageAsset {
  id: string;
  href: string;
}

function createImageEntries(assets: EpubImageAsset[]): EpubImageEntry[] {
  return assets.map((asset, index) => ({
    ...asset,
    id: `image-${String(index + 1).padStart(3, "0")}`,
    href: `images/image-${String(index + 1).padStart(3, "0")}${extensionForMediaType(
      asset.mediaType,
      asset.sourceUrl,
    )}`,
  }));
}

function extensionForMediaType(mediaType: string, sourceUrl: string): string {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/avif") {
    return ".avif";
  }

  return (
    /\.[a-z0-9]+(?:[?#].*)?$/i.exec(new URL(sourceUrl).pathname)?.[0] ?? ".bin"
  );
}

function inferMediaTypeFromUrl(url: string): string {
  const extension = extensionForMediaType("", url).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".avif") {
    return "image/avif";
  }

  return "application/octet-stream";
}
