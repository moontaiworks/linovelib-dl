const DEFAULT_BASE_URL = "https://tw.linovelib.com";
const READER_COOKIE = "night=0";
const FIXED_PARAGRAPH_COUNT = 20;
const FAKE_PARAGRAPH_COUNT = 20;

export function createLinovelHeaders(headers = {}) {
  const cookieKey = findHeaderKey(headers, "cookie") ?? "cookie";
  const cookie = headers[cookieKey];

  if (hasCookie(cookie, "night")) {
    return { ...headers };
  }

  return {
    ...headers,
    [cookieKey]: cookie ? `${cookie}; ${READER_COOKIE}` : READER_COOKIE,
  };
}

export async function fetchLinovelHtml(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    ...options,
    headers: createLinovelHeaders(options.headers),
  });

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

export function extractCatalogChapters(html, catalogUrl) {
  const chapters = [];
  const chapterPattern = /<li\b[^>]*class=["'][^"']*\bjsChapter\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;

  for (const match of html.matchAll(chapterPattern)) {
    const itemHtml = match[1];
    const href = matchFirst(itemHtml, /<a\b[^>]*href=["']([^"']+)["']/i);
    const title =
      matchFirst(itemHtml, /<span\b[^>]*class=["'][^"']*\bchapter-index\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ??
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

export function parseChapterPage(html, pageUrl) {
  if (isDegradedReaderPage(html)) {
    throw new Error(`degraded reader page: ${pageUrl}`);
  }

  const readParams = parseReadParams(html);
  const contentHtml = extractAcontentHtml(html);
  const nodes = parseContentNodes(contentHtml);
  const restoredNodes = restoreParagraphOrder(nodes, readParams.chapterid);
  const title = cleanText(matchFirst(html, /<h1\b[^>]*id=["']atitle["'][^>]*>([\s\S]*?)<\/h1>/i));
  const volumeTitle = cleanText(matchFirst(html, /<div\b[^>]*class=["'][^"']*\batitle\b[^"']*["'][^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>/i));

  return {
    url: pageUrl,
    title,
    volumeTitle,
    readParams,
    previousUrl: readParams.url_previous
      ? absolutizeUrl(readParams.url_previous, pageUrl)
      : null,
    nextUrl: readParams.url_next ? absolutizeUrl(readParams.url_next, pageUrl) : null,
    indexUrl: readParams.url_index ? absolutizeUrl(readParams.url_index, pageUrl) : null,
    lines: extractTextLines(restoredNodes),
    get text() {
      return this.lines.join("\n").trim();
    },
  };
}

export async function* walkPagesFrom(startUrl, options) {
  const fetchHtml = options.fetchHtml;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const visited = new Set();
  let currentUrl = startUrl;

  for (let count = 0; currentUrl && count < maxPages; count++) {
    if (visited.has(currentUrl)) {
      throw new Error(`detected chapter navigation loop at ${currentUrl}`);
    }

    visited.add(currentUrl);
    const html = await fetchHtml(currentUrl);
    if (typeof html !== "string") {
      throw new Error(`fetchHtml did not return HTML for ${currentUrl}`);
    }

    const page = parseChapterPage(html, currentUrl);
    yield page;
    currentUrl = page.nextUrl;
  }
}

export async function* walkNovelFromCatalog(catalogUrl, options) {
  const fetchHtml = options.fetchHtml;
  const catalogHtml = await fetchHtml(catalogUrl);
  const chapters = extractCatalogChapters(catalogHtml, catalogUrl);

  if (chapters.length === 0) {
    throw new Error(`catalog has no chapters: ${catalogUrl}`);
  }

  yield* walkPagesFrom(chapters[0].url, options);
}

export function restoreParagraphOrder(nodes, chapterId) {
  const paragraphs = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "p" && textPayload(node).replace(/\s+/g, "").length > 0);

  if (paragraphs.length === 0) {
    return nodes;
  }

  const order = createParagraphOrder(paragraphs.length, chapterId);
  const restoredParagraphs = [];

  for (let index = 0; index < paragraphs.length; index++) {
    restoredParagraphs[order[index]] = paragraphs[index].node;
  }

  const restoredNodes = nodes.slice();
  let paragraphIndex = 0;
  for (const { index } of paragraphs) {
    restoredNodes[index] = restoredParagraphs[paragraphIndex];
    paragraphIndex++;
  }

  return restoredNodes;
}

function createParagraphOrder(length, chapterId) {
  const indices = Array.from({ length }, (_, index) => index);

  if (length <= FIXED_PARAGRAPH_COUNT) {
    return indices;
  }

  const fixed = indices.slice(0, FIXED_PARAGRAPH_COUNT);
  const shuffled = seededShuffle(
    indices.slice(FIXED_PARAGRAPH_COUNT),
    createChapterSeed(chapterId),
  );

  return fixed.concat(shuffled);
}

function seededShuffle(values, seed) {
  const shuffled = values.slice();
  let state = Number(seed);

  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (state * 9302 + 49397) % 233280;
    const target = Math.floor((state / 233280) * (index + 1));
    const currentValue = shuffled[index];
    shuffled[index] = shuffled[target];
    shuffled[target] = currentValue;
  }

  return shuffled;
}

function createChapterSeed(chapterId) {
  return Number(chapterId) * 126 + 232;
}

function parseReadParams(html) {
  const body = matchFirst(html, /var\s+ReadParams\s*=\s*\{([\s\S]*?)\}\s*;?\s*<\/script>/i);
  if (!body) {
    throw new Error("missing ReadParams");
  }

  const params = {};
  const pairPattern = /([A-Za-z_][\w]*)\s*:\s*(?:"([^"]*)"|'([^']*)')\s*,?/g;

  for (const match of body.matchAll(pairPattern)) {
    params[match[1]] = decodeHtml(match[2] ?? match[3] ?? "");
  }

  return params;
}

function extractAcontentHtml(html) {
  const startMatch = /<div\b[^>]*id=["']acontent["'][^>]*>/i.exec(html);
  if (!startMatch) {
    throw new Error("missing #acontent");
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const endIndex = findClosingDiv(html, startIndex);
  return html.slice(startIndex, endIndex);
}

function findClosingDiv(html, startIndex) {
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = startIndex;
  let depth = 1;

  for (const match of html.matchAll(tagPattern)) {
    if (match[0][1] === "/") {
      depth--;
      if (depth === 0) {
        return match.index;
      }
    } else {
      depth++;
    }
  }

  throw new Error("unterminated #acontent");
}

function parseContentNodes(contentHtml) {
  const nodes = [];
  const nodePattern =
    /<p\b[^>]*>[\s\S]*?<\/p>|<center\b[^>]*>[\s\S]*?<\/center>|<img\b[^>]*>|<br\b[^>]*>/gi;

  for (const match of contentHtml.matchAll(nodePattern)) {
    const raw = match[0];
    const type = raw.slice(1).match(/^\w+/)?.[0]?.toLowerCase();

    if (type === "img") {
      nodes.push({ type, raw, src: decodeHtml(matchFirst(raw, /\bsrc=["']([^"']+)["']/i)) });
    } else if (type === "br") {
      nodes.push({ type, raw });
    } else {
      nodes.push({ type, raw, text: cleanText(raw) });
    }
  }

  return nodes;
}

function extractTextLines(nodes) {
  const lines = [];

  for (const node of nodes) {
    if (node.type === "br") {
      appendBlank(lines);
      continue;
    }

    if (node.type === "img" && node.src) {
      appendText(lines, node.src);
      continue;
    }

    if ((node.type === "p" || node.type === "center") && textPayload(node)) {
      appendText(lines, textPayload(node));
    }
  }

  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function appendText(lines, value) {
  const text = value.trim();
  if (text) {
    lines.push(text);
  }
}

function appendBlank(lines) {
  if (lines.length > 0 && lines.at(-1) !== "") {
    lines.push("");
  }
}

function textPayload(node) {
  return node.text ?? "";
}

function isDegradedReaderPage(html) {
  return html.includes("內容加載失敗") || html.includes("暫不支持電腦端閱讀");
}

function cleanText(html) {
  return decodeHtml(stripTags(html))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function stripTags(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "");
}

function decodeHtml(value = "") {
  const namedEntities = {
    amp: "&",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    apos: "'",
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === "#") {
      const codePoint =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return namedEntities[body.toLowerCase()] ?? entity;
  });
}

function absolutizeUrl(url, baseUrl = DEFAULT_BASE_URL) {
  return new URL(url, baseUrl).href;
}

function matchFirst(value, pattern) {
  return pattern.exec(value)?.[1] ?? "";
}

function findHeaderKey(headers, wantedKey) {
  const lowerWantedKey = wantedKey.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lowerWantedKey);
}

function hasCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(";")
    .some((cookie) => cookie.trim().toLowerCase().startsWith(`${name.toLowerCase()}=`));
}

export const internals = {
  createChapterSeed,
  createParagraphOrder,
  seededShuffle,
  fakeParagraphCount: FAKE_PARAGRAPH_COUNT,
};
