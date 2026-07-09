import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import yazl from "yazl";
import { ChapterPage } from "./types.js";

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
}

export interface EpubFile {
  path: string;
  content: string | Buffer;
  compression?: "store" | "compress";
}

export function createVolumeEpubFiles(input: CreateVolumeEpubFilesInput): EpubFile[] {
  const chapters = input.chapters.map((chapter, index) => ({
    ...chapter,
    id: `chapter-${String(index + 1).padStart(3, "0")}`,
    href: `chapters/chapter-${String(index + 1).padStart(3, "0")}.xhtml`,
  }));

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
      content: renderContentOpf(input, chapters),
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
      content: renderChapterXhtml(input.title, chapter.title, chapter.pages),
    })),
  ];
}

export async function writeEpubFile(files: EpubFile[], outputPath: string): Promise<void> {
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
): string {
  const language = input.language ?? "zh-TW";
  const author = input.author ?? "Linovelib";
  const chapterManifest = chapters
    .map(
      (chapter) =>
        `    <item id="${chapter.id}" href="${xmlAttr(chapter.href)}" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spine = chapters.map((chapter) => `    <itemref idref="${chapter.id}"/>`).join("\n");

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
${chapterManifest}
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
    .map((chapter) => `      <li><a href="${xmlAttr(chapter.href)}">${xmlText(chapter.title)}</a></li>`)
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
      (chapter, index) => `    <navPoint id="${chapter.id}" playOrder="${index + 1}">
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

function renderChapterXhtml(volumeTitle: string, chapterTitle: string, pages: ChapterPage[]): string {
  const paragraphs = pages
    .flatMap((page) => page.lines)
    .filter((line) => line.trim().length > 0)
    .map(renderLine)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-TW">
  <head>
    <title>${xmlText(chapterTitle)}</title>
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

function renderLine(line: string): string {
  const trimmed = line.trim();
  if (/^https?:\/\/\S+\.(?:avif|gif|jpe?g|png|webp)(?:[?#]\S*)?$/i.test(trimmed)) {
    return `      <p><a href="${xmlAttr(trimmed)}">${xmlText(trimmed)}</a></p>`;
  }

  return `      <p>${xmlText(trimmed)}</p>`;
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
