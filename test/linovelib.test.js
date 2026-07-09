import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createThrottledFetchHtml,
  createVolumeEpubFiles,
  downloadEpubImageAssets,
  formatCliHelp,
  parseCliOptions,
  createLinovelImageHeaders,
  createLinovelHeaders,
  downloadBook,
  downloadCatalogVolumes,
  downloadChapter,
  extractCatalogVolumes,
  extractCatalogChapters,
  parseChapterPage,
  walkPagesFrom,
} from "../dist/index.js";

const fixture = (name) => new URL(`../example.local/${name}`, import.meta.url);

const readFixture = async (name) => readFile(fixture(name), "utf8");

test("createLinovelHeaders sends the reading-state cookie needed for full HTML", () => {
  assert.deepEqual(createLinovelHeaders(), { cookie: "night=0" });
  assert.deepEqual(createLinovelHeaders({ cookie: "foo=bar" }), {
    cookie: "foo=bar; night=0",
  });
  assert.deepEqual(createLinovelHeaders({ cookie: "night=1" }), {
    cookie: "night=1",
  });
});

test("createLinovelImageHeaders sends the referer needed by readpai images", () => {
  assert.deepEqual(createLinovelImageHeaders(), {
    Referer: "https://tw.linovelib.com/",
  });
  assert.deepEqual(createLinovelImageHeaders({ Accept: "image/avif,image/webp,*/*" }), {
    Accept: "image/avif,image/webp,*/*",
    Referer: "https://tw.linovelib.com/",
  });
  assert.deepEqual(createLinovelImageHeaders({ referer: "https://example.test/" }), {
    referer: "https://example.test/",
  });
});

test("parseCliOptions accepts book and chapter download options", () => {
  assert.deepEqual(
    parseCliOptions([
      "--book-id",
      "2013",
      "--chapter-id",
      "72034",
      "--max-pages",
      "2",
      "--request-interval-ms",
      "500",
    ]),
    {
      command: "download",
      bookId: "2013",
      chapterId: "72034",
      format: "json",
      maxPages: 2,
      requestIntervalMs: 500,
    },
  );

  assert.deepEqual(
    parseCliOptions([
      "-b",
      "2013",
      "--volume-id",
      "72033",
      "--format",
      "epub",
      "--output",
      "books",
      "--max-pages",
      "1",
    ]),
    {
      command: "download",
      bookId: "2013",
      volumeId: "72033",
      format: "epub",
      output: "books",
      maxPages: 1,
      requestIntervalMs: 250,
    },
  );

  assert.deepEqual(parseCliOptions(["-b", "2013", "--max-pages", "1"]), {
    command: "download",
    bookId: "2013",
    format: "json",
    maxPages: 1,
    requestIntervalMs: 250,
  });
});

test("parseCliOptions handles help and validates required book id", () => {
  assert.deepEqual(parseCliOptions(["--help"]), { command: "help" });
  assert.match(formatCliHelp(), /--book-id/);
  assert.match(formatCliHelp(), /--format/);
  assert.match(formatCliHelp(), /--request-interval-ms/);
  assert.throws(() => parseCliOptions([]), /Missing required option: --book-id/);
  assert.throws(() => parseCliOptions(["--book-id", "2013", "--max-pages", "0"]), /positive integer/);
  assert.throws(() => parseCliOptions(["--book-id", "2013", "--format", "txt"]), /--format/);
  assert.throws(
    () => parseCliOptions(["--book-id", "2013", "--request-interval-ms", "-1"]),
    /non-negative integer/,
  );
});

test("createThrottledFetchHtml waits between sequential requests", async () => {
  const calls = [];
  const waits = [];
  let now = 1000;
  const fetchHtml = async (url) => {
    calls.push({ url, at: now });
    return url;
  };
  const throttled = createThrottledFetchHtml(fetchHtml, {
    intervalMs: 250,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });

  assert.equal(await throttled("first"), "first");
  assert.equal(await throttled("second"), "second");
  now += 300;
  assert.equal(await throttled("third"), "third");

  assert.deepEqual(waits, [250]);
  assert.deepEqual(calls, [
    { url: "first", at: 1000 },
    { url: "second", at: 1250 },
    { url: "third", at: 1550 },
  ]);
});

test("extractCatalogChapters reads chapter links in catalog order", async () => {
  const html = await readFixture("catalog.html");

  const chapters = extractCatalogChapters(
    html,
    "https://tw.linovelib.com/novel/2013/catalog",
  );

  assert.equal(chapters.length, 620);
  assert.deepEqual(chapters.slice(0, 3), [
    {
      title: "插圖",
      url: "https://tw.linovelib.com/novel/2013/122012.html",
    },
    {
      title: "序章",
      url: "https://tw.linovelib.com/novel/2013/72034.html",
    },
    {
      title: "第一話「難道是：異世界」",
      url: "https://tw.linovelib.com/novel/2013/72035.html",
    },
  ]);
});

test("extractCatalogVolumes groups catalog chapters by physical volume", async () => {
  const html = await readFixture("catalog.html");

  const volumes = extractCatalogVolumes(
    html,
    "https://tw.linovelib.com/novel/2013/catalog",
  );

  assert.equal(volumes[0].volumeId, "72033");
  assert.equal(volumes[0].title, "無職轉生 ～到了異世界就拿出真本事～ 1 幼年期");
  assert.equal(volumes[0].url, "https://tw.linovelib.com/novel/2013/vol_72033.html");
  assert.equal(volumes[0].coverUrl, "https://img3.readpai.com/cover/2013/163854.jpg");
  assert.equal(volumes[0].chapters.length, 20);
  assert.deepEqual(volumes[0].chapters.slice(0, 3), [
    {
      kind: "resolved",
      title: "插圖",
      url: "https://tw.linovelib.com/novel/2013/122012.html",
    },
    {
      kind: "resolved",
      title: "序章",
      url: "https://tw.linovelib.com/novel/2013/72034.html",
    },
    {
      kind: "resolved",
      title: "第一話「難道是：異世界」",
      url: "https://tw.linovelib.com/novel/2013/72035.html",
    },
  ]);

  assert.equal(volumes[1].volumeId, "72048");
  assert.equal(volumes[1].title, "無職轉生 ～到了異世界就拿出真本事～ 2 少年期 家庭教師篇");
  assert.deepEqual(volumes[1].chapters[2], {
    kind: "unresolved",
    title: "第一話「大小姐的暴力」",
    rawHref: "javascript:cid(1)",
  });
});

test("extractCatalogChapters tolerates nested markup inside a catalog item", () => {
  const html = `
    <ul>
      <li class="chapter-li jsChapter">
        <div><ul><li>nested marker</li></ul></div>
        <a href="/novel/2013/999.html" class="chapter-li-a">
          <span class="chapter-index">番外 <em>短篇</em></span>
        </a>
      </li>
    </ul>
  `;

  assert.deepEqual(
    extractCatalogChapters(html, "https://tw.linovelib.com/novel/2013/catalog"),
    [
      {
        title: "番外 短篇",
        url: "https://tw.linovelib.com/novel/2013/999.html",
      },
    ],
  );
});

test("parseChapterPage rejects degraded reader HTML", async () => {
  const html = await readFixture("72034-inprivate.html");

  assert.throws(
    () => parseChapterPage(html, "https://tw.linovelib.com/novel/2013/72034.html"),
    /degraded reader page/,
  );
});

test("parseChapterPage restores obfuscated paragraphs and extracts text", async () => {
  const html = await readFixture("72034.html");
  const expected = (await readFixture("72034.txt")).trim();

  const page = parseChapterPage(
    html,
    "https://tw.linovelib.com/novel/2013/72034.html",
  );

  assert.equal(page.title, "序章");
  assert.equal(page.readParams.chapterid, "72034");
  assert.equal(page.nextUrl, "https://tw.linovelib.com/novel/2013/72034_2.html");
  assert.equal(page.text.trim(), expected);
});

test("parseChapterPage extracts lazy-loaded illustration image URLs", async () => {
  const page = parseChapterPage(
    await readFixture("122012.html"),
    "https://tw.linovelib.com/novel/2013/122012.html",
  );

  const firstImage = page.content.find((node) => node.type === "img");

  assert.ok(page.lines.includes("https://img3.readpai.com/2/2013/122012/163854.jpg"));
  assert.equal(firstImage?.src, "https://img3.readpai.com/2/2013/122012/163854.jpg");
  assert.ok(!page.lines.includes("https://tw.linovelib.com/images/sloading.svg"));
});

test("parseChapterPage accepts compact live ReadParams without a semicolon", async () => {
  const html = (await readFixture("72034_2.html"))
    .replace("var ReadParams = {", "var ReadParams={")
    .replace(/,\n\s*};/, "\n}");

  const page = parseChapterPage(
    html,
    "https://tw.linovelib.com/novel/2013/72034_2.html",
  );

  assert.equal(page.readParams.chapterid, "72034");
  assert.equal(page.nextUrl, "https://tw.linovelib.com/novel/2013/72035.html");
});

test("walkPagesFrom follows url_next through split pages", async () => {
  const pages = new Map([
    [
      "https://tw.linovelib.com/novel/2013/72034.html",
      await readFixture("72034.html"),
    ],
    [
      "https://tw.linovelib.com/novel/2013/72034_2.html",
      await readFixture("72034_2.html"),
    ],
    [
      "https://tw.linovelib.com/novel/2013/72035.html",
      await readFixture("72035.html"),
    ],
  ]);

  const visited = [];
  for await (const page of walkPagesFrom(
    "https://tw.linovelib.com/novel/2013/72034.html",
    {
      fetchHtml: async (url) => pages.get(url),
      maxPages: 3,
    },
  )) {
    visited.push([page.url, page.readParams.chapterid, page.readParams.page]);
  }

  assert.deepEqual(visited, [
    ["https://tw.linovelib.com/novel/2013/72034.html", "72034", "1"],
    ["https://tw.linovelib.com/novel/2013/72034_2.html", "72034", "2"],
    ["https://tw.linovelib.com/novel/2013/72035.html", "72035", "1"],
  ]);
});

test("downloadChapter starts from a book id and chapter id", async () => {
  const pages = new Map([
    [
      "https://tw.linovelib.com/novel/2013/72034.html",
      await readFixture("72034.html"),
    ],
    [
      "https://tw.linovelib.com/novel/2013/72034_2.html",
      await readFixture("72034_2.html"),
    ],
    [
      "https://tw.linovelib.com/novel/2013/72035.html",
      await readFixture("72035.html"),
    ],
  ]);

  const result = await downloadChapter(
    { bookId: "2013", chapterId: "72034", maxPages: 2 },
    { fetchHtml: async (url) => pages.get(url) },
  );

  assert.equal(result.bookId, "2013");
  assert.deepEqual(
    result.pages.map((page) => [page.readParams.chapterid, page.readParams.page]),
    [
      ["72034", "1"],
      ["72034", "2"],
    ],
  );
});

test("downloadBook starts from catalog first chapter", async () => {
  const pages = new Map([
    [
      "https://tw.linovelib.com/novel/2013/catalog",
      await readFixture("catalog.html"),
    ],
    [
      "https://tw.linovelib.com/novel/2013/122012.html",
      await readFixture("122012.html"),
    ],
    [
      "https://tw.linovelib.com/novel/2013/72034.html",
      await readFixture("72034.html"),
    ],
  ]);

  const result = await downloadBook(
    { bookId: "2013", maxPages: 2 },
    { fetchHtml: async (url) => pages.get(url) },
  );

  assert.equal(result.bookId, "2013");
  assert.deepEqual(
    result.pages.map((page) => [page.readParams.chapterid, page.readParams.page]),
    [
      ["122012", "1"],
      ["72034", "1"],
    ],
  );
});

test("downloadCatalogVolumes rejects volumes with unresolved catalog chapters", async () => {
  const catalogHtml = await readFixture("catalog.html");

  await assert.rejects(
    () =>
      downloadCatalogVolumes(
        { bookId: "2013", volumeId: "72048" },
        {
          fetchHtml: async (url) => {
            assert.equal(url, "https://tw.linovelib.com/novel/2013/catalog");
            return catalogHtml;
          },
        },
      ),
    /volume 72048 has unresolved catalog chapters: 第一話「大小姐的暴力」 \(javascript:cid\(1\)\)/,
  );
});

test("createVolumeEpubFiles renders a valid EPUB file set for a volume", async () => {
  const page = parseChapterPage(
    await readFixture("72034.html"),
    "https://tw.linovelib.com/novel/2013/72034.html",
  );

  const files = createVolumeEpubFiles({
    bookId: "2013",
    title: "無職轉生 ～到了異世界就拿出真本事～ 1 幼年期",
    identifier: "linovelib-2013-72033",
    chapters: [
      {
        title: "序章",
        pages: [page],
      },
    ],
  });

  const byPath = new Map(files.map((file) => [file.path, file]));
  assert.equal(byPath.get("mimetype").content, "application/epub+zip");
  assert.equal(byPath.get("mimetype").compression, "store");
  assert.match(byPath.get("META-INF/container.xml").content, /content\.opf/);
  assert.match(byPath.get("OEBPS/content.opf").content, /linovelib-2013-72033/);
  assert.match(byPath.get("OEBPS/nav.xhtml").content, /序章/);
  assert.match(byPath.get("OEBPS/chapters/chapter-001.xhtml").content, /序章/);
  assert.match(byPath.get("OEBPS/chapters/chapter-001.xhtml").content, /本人現年三十四歲/);
});

test("createVolumeEpubFiles embeds downloaded illustration assets", async () => {
  const page = parseChapterPage(
    await readFixture("122012.html"),
    "https://tw.linovelib.com/novel/2013/122012.html",
  );

  const files = createVolumeEpubFiles({
    bookId: "2013",
    title: "無職轉生 ～到了異世界就拿出真本事～ 1 幼年期",
    identifier: "linovelib-2013-72033",
    chapters: [
      {
        title: "插圖",
        pages: [page],
      },
    ],
    imageAssets: [
      {
        sourceUrl: "https://img3.readpai.com/2/2013/122012/163854.jpg",
        mediaType: "image/jpeg",
        content: Buffer.from("fake-image"),
      },
    ],
  });

  const byPath = new Map(files.map((file) => [file.path, file]));
  assert.deepEqual(byPath.get("OEBPS/images/image-001.jpg").content, Buffer.from("fake-image"));
  assert.match(byPath.get("OEBPS/content.opf").content, /media-type="image\/jpeg"/);
  assert.match(
    byPath.get("OEBPS/chapters/chapter-001.xhtml").content,
    /<img src="\.\.\/images\/image-001\.jpg" alt="https:\/\/img3\.readpai\.com\/2\/2013\/122012\/163854\.jpg"\/>/,
  );
});

test("downloadEpubImageAssets downloads unique images from chapter content", async () => {
  const page = parseChapterPage(
    await readFixture("122012.html"),
    "https://tw.linovelib.com/novel/2013/122012.html",
  );
  const fetched = [];

  const assets = await downloadEpubImageAssets(
    [
      {
        title: "插圖",
        pages: [page, page],
      },
    ],
    async (url) => {
      fetched.push(url);
      return {
        content: Buffer.from(url),
        mediaType: "image/jpeg",
      };
    },
  );

  assert.equal(fetched[0], "https://img3.readpai.com/2/2013/122012/163854.jpg");
  assert.equal(fetched.length, new Set(fetched).size);
  assert.equal(assets[0].sourceUrl, "https://img3.readpai.com/2/2013/122012/163854.jpg");
  assert.deepEqual(assets[0].content, Buffer.from("https://img3.readpai.com/2/2013/122012/163854.jpg"));
});
