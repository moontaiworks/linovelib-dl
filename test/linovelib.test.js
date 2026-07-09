import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createLinovelHeaders,
  downloadBook,
  downloadChapter,
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
