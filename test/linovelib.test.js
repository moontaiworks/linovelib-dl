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
  streamCatalogVolumes,
  extractVolumePageChapters,
  extractCatalogVolumes,
  extractCatalogChapters,
  parseChapterPage,
  shouldContinueChapter,
  walkPagesFrom,
  fetchLinovelHtml,
} from "../dist/index.js";
import { formatEpubFileName } from "../dist/cli.js";

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
  assert.deepEqual(
    createLinovelImageHeaders({ Accept: "image/avif,image/webp,*/*" }),
    {
      Accept: "image/avif,image/webp,*/*",
      Referer: "https://tw.linovelib.com/",
    },
  );
  assert.deepEqual(
    createLinovelImageHeaders({ referer: "https://example.test/" }),
    {
      referer: "https://example.test/",
    },
  );
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
      "--start-volume-id",
      "72048",
      "--format",
      "epub",
      "--output",
      "books",
    ]),
    {
      command: "download",
      bookId: "2013",
      startVolumeId: "72048",
      format: "epub",
      output: "books",
      requestIntervalMs: 250,
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
  assert.match(formatCliHelp(), /--start-volume-id/);
  assert.match(formatCliHelp(), /--request-interval-ms/);
  assert.throws(
    () => parseCliOptions([]),
    /Missing required option: --book-id/,
  );
  assert.throws(
    () => parseCliOptions(["--book-id", "2013", "--max-pages", "0"]),
    /positive integer/,
  );
  assert.throws(
    () => parseCliOptions(["--book-id", "2013", "--format", "txt"]),
    /--format/,
  );
  assert.throws(
    () => parseCliOptions(["--book-id", "2013", "--request-interval-ms", "-1"]),
    /non-negative integer/,
  );
  assert.throws(
    () => parseCliOptions(["--book-id", "2013", "--start-volume-id", "72048"]),
    /--start-volume-id can only be used with --format epub/,
  );
  assert.throws(
    () =>
      parseCliOptions([
        "--book-id",
        "2013",
        "--volume-id",
        "72033",
        "--start-volume-id",
        "72048",
        "--format",
        "epub",
        "--output",
        "books",
      ]),
    /--start-volume-id cannot be used with --volume-id/,
  );
});

test("formatEpubFileName prefixes the volume title with Linovelib ids", () => {
  assert.equal(
    formatEpubFileName(
      1,
      "2013",
      "72288",
      "無職轉生 ～到了異世界就拿出真本事～ 1 幼年期",
    ),
    "001 無職轉生 ～到了異世界就拿出真本事～ 1 幼年期 2013-72288.epub",
  );
  assert.equal(
    formatEpubFileName(12, "2013", "72288", 'A<B>:"C"'),
    "012 A_B___C_ 2013-72288.epub",
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

test("fetchLinovelHtml waits for the rate limit reset before retrying", async () => {
  const calls = [];
  const waits = [];
  let now = 1_700_000_000_000;
  const fetchImpl = async (url) => {
    calls.push(url);
    return calls.length === 1
      ? new Response("", {
          status: 429,
          headers: { "x-ratelimit-reset": "1700000005" },
        })
      : new Response("ok");
  };

  assert.equal(
    await fetchLinovelHtml("https://example.test/page", {
      fetchImpl,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    }),
    "ok",
  );
  assert.deepEqual(calls, [
    "https://example.test/page",
    "https://example.test/page",
  ]);
  assert.deepEqual(waits, [5000]);
});

test("fetchLinovelHtml uses the default wait when 429 has no reset header", async () => {
  let callCount = 0;
  const waits = [];

  assert.equal(
    await fetchLinovelHtml("https://example.test/page", {
      fetchImpl: async () => {
        callCount += 1;
        return callCount === 1
          ? new Response("", { status: 429 })
          : new Response("ok");
      },
      rateLimitDefaultMs: 1234,
      sleep: async (ms) => waits.push(ms),
    }),
    "ok",
  );
  assert.deepEqual(waits, [1234]);
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
  assert.equal(
    volumes[0].title,
    "無職轉生 ～到了異世界就拿出真本事～ 1 幼年期",
  );
  assert.equal(
    volumes[0].url,
    "https://tw.linovelib.com/novel/2013/vol_72033.html",
  );
  assert.equal(
    volumes[0].coverUrl,
    "https://img3.readpai.com/cover/2013/163854.jpg",
  );
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
  assert.equal(
    volumes[1].title,
    "無職轉生 ～到了異世界就拿出真本事～ 2 少年期 家庭教師篇",
  );
  assert.deepEqual(volumes[1].chapters[2], {
    kind: "unresolved",
    title: "第一話「大小姐的暴力」",
    rawHref: "javascript:cid(1)",
  });
});

test("extractVolumePageChapters reads complete links from a volume page", () => {
  const html = `
    <div class="catalog-volume">
      <ul class="module-content">
        <li class="chapter-li jsChapter"><a href="/novel/2013/72049.html"><span class="chapter-title">序章</span></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72050.html"><span class="chapter-title">第一話「大小姐的暴力」</span></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72051.html"><span class="chapter-title">第二話「自導自演」</span></a></li>
      </ul>
    </div>
  `;

  assert.deepEqual(
    extractVolumePageChapters(
      html,
      "https://tw.linovelib.com/novel/2013/vol_72048.html",
    ),
    [
      {
        kind: "resolved",
        title: "序章",
        url: "https://tw.linovelib.com/novel/2013/72049.html",
      },
      {
        kind: "resolved",
        title: "第一話「大小姐的暴力」",
        url: "https://tw.linovelib.com/novel/2013/72050.html",
      },
      {
        kind: "resolved",
        title: "第二話「自導自演」",
        url: "https://tw.linovelib.com/novel/2013/72051.html",
      },
    ],
  );
});

test("downloadCatalogVolumes resolves catalog placeholders from the volume page", async () => {
  const catalogHtml = `
    <div class="catalog-volume">
      <ul class="volume-chapters">
        <li class="chapter-bar chapter-li"><a href="/novel/2013/vol_72048.html">
          <h3>無職轉生 ～到了異世界就拿出真本事～ 2 少年期 家庭教師篇</h3>
        </a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72049.html"><span class="chapter-index">序章</span></a></li>
        <li class="chapter-li jsChapter"><a href="javascript:cid(1)"><span class="chapter-index">第一話「大小姐的暴力」</span></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72051.html"><span class="chapter-index">第二話「自導自演」</span></a></li>
      </ul>
    </div>
  `;
  const volumeHtml = `
    <div class="catalog-volume">
      <ul class="module-content">
        <li class="chapter-li jsChapter"><a href="/novel/2013/72049.html"><span class="chapter-title">序章</span></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72050.html"><span class="chapter-title">第一話「大小姐的暴力」</span></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72051.html"><span class="chapter-title">第二話「自導自演」</span></a></li>
      </ul>
    </div>
  `;
  const chapterHtml = await readFixture("72034.html");
  const fetched = [];

  const result = await downloadCatalogVolumes(
    { bookId: "2013", volumeId: "72048", maxPages: 1 },
    {
      fetchHtml: async (url) => {
        fetched.push(url);
        if (url === "https://tw.linovelib.com/novel/2013/catalog") {
          return catalogHtml;
        }
        if (url === "https://tw.linovelib.com/novel/2013/vol_72048.html") {
          return volumeHtml;
        }
        return chapterHtml;
      },
    },
  );

  assert.ok(
    fetched.includes("https://tw.linovelib.com/novel/2013/vol_72048.html"),
  );
  assert.equal(result[0].volume.chapters[1].kind, "resolved");
  assert.equal(
    result[0].volume.chapters[1].url,
    "https://tw.linovelib.com/novel/2013/72050.html",
  );
});

test("streamCatalogVolumes yields the first completed volume before fetching the next one", async () => {
  const catalogHtml = `
    <div class="catalog-volume">
      <ul class="volume-chapters">
        <li class="chapter-bar chapter-li"><a href="/novel/2013/vol_72033.html"><h3>第一卷</h3></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72034.html"><span class="chapter-index">序章</span></a></li>
      </ul>
    </div>
    <div class="catalog-volume">
      <ul class="volume-chapters">
        <li class="chapter-bar chapter-li"><a href="/novel/2013/vol_72048.html"><h3>第二卷</h3></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72035.html"><span class="chapter-index">第一話</span></a></li>
      </ul>
    </div>
  `;
  const fetched = [];
  const iterator = streamCatalogVolumes(
    { bookId: "2013" },
    {
      fetchHtml: async (url) => {
        fetched.push(url);
        if (url === "https://tw.linovelib.com/novel/2013/catalog") {
          return catalogHtml;
        }
        if (url === "https://tw.linovelib.com/novel/2013/72034.html") {
          return readFixture("72034.html");
        }
        if (url === "https://tw.linovelib.com/novel/2013/72034_2.html") {
          return readFixture("72034_2.html");
        }
        if (url === "https://tw.linovelib.com/novel/2013/72035.html") {
          return readFixture("72035.html");
        }
        throw new Error(`unexpected url: ${url}`);
      },
    },
  );

  const first = await iterator.next();

  assert.equal(first.done, false);
  assert.equal(first.value.volume.volumeId, "72033");
  assert.deepEqual(fetched, [
    "https://tw.linovelib.com/novel/2013/catalog",
    "https://tw.linovelib.com/novel/2013/72034.html",
    "https://tw.linovelib.com/novel/2013/72034_2.html",
  ]);
});

test("streamCatalogVolumes starts from the requested volume id", async () => {
  const catalogHtml = `
    <div class="catalog-volume">
      <ul class="volume-chapters">
        <li class="chapter-bar chapter-li"><a href="/novel/2013/vol_72033.html"><h3>第一卷</h3></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72034.html"><span class="chapter-index">序章</span></a></li>
      </ul>
    </div>
    <div class="catalog-volume">
      <ul class="volume-chapters">
        <li class="chapter-bar chapter-li"><a href="/novel/2013/vol_72048.html"><h3>第二卷</h3></a></li>
        <li class="chapter-li jsChapter"><a href="/novel/2013/72035.html"><span class="chapter-index">第一話</span></a></li>
      </ul>
    </div>
  `;
  const fetched = [];
  const seenVolumes = [];

  for await (const result of streamCatalogVolumes(
    { bookId: "2013", startVolumeId: "72048", maxPages: 1 },
    {
      fetchHtml: async (url) => {
        fetched.push(url);
        if (url === "https://tw.linovelib.com/novel/2013/catalog") {
          return catalogHtml;
        }
        if (url === "https://tw.linovelib.com/novel/2013/72035.html") {
          return readFixture("72035.html");
        }
        throw new Error(`unexpected url: ${url}`);
      },
    },
  )) {
    seenVolumes.push(result.volume.volumeId);
  }

  assert.deepEqual(seenVolumes, ["72048"]);
  assert.deepEqual(fetched, [
    "https://tw.linovelib.com/novel/2013/catalog",
    "https://tw.linovelib.com/novel/2013/72035.html",
  ]);
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
    () =>
      parseChapterPage(html, "https://tw.linovelib.com/novel/2013/72034.html"),
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
  assert.equal(
    page.nextUrl,
    "https://tw.linovelib.com/novel/2013/72034_2.html",
  );
  assert.equal(page.text.trim(), expected);
});

test("parseChapterPage extracts lazy-loaded illustration image URLs", async () => {
  const page = parseChapterPage(
    await readFixture("122012.html"),
    "https://tw.linovelib.com/novel/2013/122012.html",
  );

  const firstImage = page.content.find((node) => node.type === "img");

  assert.ok(
    page.lines.includes("https://img3.readpai.com/2/2013/122012/163854.jpg"),
  );
  assert.equal(
    firstImage?.src,
    "https://img3.readpai.com/2/2013/122012/163854.jpg",
  );
  assert.ok(
    !page.lines.includes("https://tw.linovelib.com/images/sloading.svg"),
  );
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

test("parseChapterPage keeps catalog navigation on a chapter's last page", async () => {
  const page = parseChapterPage(
    await readFixture("226930_2.html"),
    "https://tw.linovelib.com/novel/2013/226930_2.html",
  );

  assert.equal(page.readParams.chapterid, "226930");
  assert.equal(page.nextUrl, "https://tw.linovelib.com/novel/2013/catalog");
  assert.equal(page.indexUrl, "https://tw.linovelib.com/novel/2013/catalog");
  assert.equal(page.nextLinkLabel, "返回目录");
});

test("shouldContinueChapter stops when the next link returns to catalog", async () => {
  const page = parseChapterPage(
    await readFixture("226930_2.html"),
    "https://tw.linovelib.com/novel/2013/226930_2.html",
  );

  assert.equal(shouldContinueChapter("226930")(page), false);
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
    result.pages.map((page) => [
      page.readParams.chapterid,
      page.readParams.page,
    ]),
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
    result.pages.map((page) => [
      page.readParams.chapterid,
      page.readParams.page,
    ]),
    [
      ["122012", "1"],
      ["72034", "1"],
    ],
  );
});

test("downloadCatalogVolumes rejects volumes that remain unresolved after checking the volume page", async () => {
  const catalogHtml = await readFixture("catalog.html");

  await assert.rejects(
    () =>
      downloadCatalogVolumes(
        { bookId: "2013", volumeId: "72048" },
        {
          fetchHtml: async (url) =>
            url === "https://tw.linovelib.com/novel/2013/catalog"
              ? catalogHtml
              : `
                <div class="catalog-volume">
                  <ul class="module-content">
                    <li class="chapter-li jsChapter"><a href="javascript:cid(1)"><span class="chapter-title">第一話「大小姐的暴力」</span></a></li>
                  </ul>
                </div>
              `,
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
  assert.match(
    byPath.get("OEBPS/chapters/chapter-001.xhtml").content,
    /本人現年三十四歲/,
  );
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
  assert.deepEqual(
    byPath.get("OEBPS/images/image-001.jpg").content,
    Buffer.from("fake-image"),
  );
  assert.match(
    byPath.get("OEBPS/content.opf").content,
    /media-type="image\/jpeg"/,
  );
  assert.match(
    byPath.get("OEBPS/chapters/chapter-001.xhtml").content,
    /<img src="\.\.\/images\/image-001\.jpg" alt="https:\/\/img3\.readpai\.com\/2\/2013\/122012\/163854\.jpg"\/>/,
  );
});

test("createVolumeEpubFiles preserves intended blank lines in chapter output", async () => {
  const page = parseChapterPage(
    await readFixture("72035.html"),
    "https://tw.linovelib.com/novel/2013/72035.html",
  );

  const files = createVolumeEpubFiles({
    bookId: "2013",
    title: "無職轉生 ～到了異世界就拿出真本事～ 1 幼年期",
    identifier: "linovelib-2013-72033",
    chapters: [
      {
        title: "第一話「難道是：異世界」",
        pages: [page],
      },
    ],
  });

  const byPath = new Map(files.map((file) => [file.path, file]));
  assert.match(
    byPath.get("OEBPS/chapters/chapter-001.xhtml").content,
    /<p>「啊──嗚啊──」<\/p>\s*<br \/>\s*<p>腦袋裡雖然這樣想，然而口中卻發出分不清是呻吟還是喘氣的聲音。<\/p>/,
  );
});

test("createVolumeEpubFiles leaves a placeholder and source link for missing images", async () => {
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
  });

  const byPath = new Map(files.map((file) => [file.path, file]));
  assert.match(
    byPath.get("OEBPS/chapters/chapter-001.xhtml").content,
    /照片載入失敗/,
  );
  assert.match(
    byPath.get("OEBPS/chapters/chapter-001.xhtml").content,
    /<a href="https:\/\/img3\.readpai\.com\/2\/2013\/122012\/163854\.jpg">https:\/\/img3\.readpai\.com\/2\/2013\/122012\/163854\.jpg<\/a>/,
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
  assert.equal(
    assets[0].sourceUrl,
    "https://img3.readpai.com/2/2013/122012/163854.jpg",
  );
  assert.deepEqual(
    assets[0].content,
    Buffer.from("https://img3.readpai.com/2/2013/122012/163854.jpg"),
  );
});

test("downloadEpubImageAssets skips failed image downloads", async () => {
  const failingPage = {
    content: [
      { type: "img", raw: "", src: "https://img.example.test/missing.jpg" },
      { type: "img", raw: "", src: "https://img.example.test/ok.jpg" },
    ],
  };
  const fetched = [];

  const assets = await downloadEpubImageAssets(
    [
      {
        title: "插圖",
        pages: [failingPage],
      },
    ],
    async (url) => {
      fetched.push(url);
      if (url.endsWith("missing.jpg")) {
        throw new Error(`failed to fetch ${url}: HTTP 404`);
      }

      return {
        content: Buffer.from(url),
        mediaType: "image/jpeg",
      };
    },
  );

  assert.deepEqual(fetched, [
    "https://img.example.test/missing.jpg",
    "https://img.example.test/ok.jpg",
  ]);
  assert.deepEqual(
    assets.map((asset) => asset.sourceUrl),
    ["https://img.example.test/ok.jpg"],
  );
});
