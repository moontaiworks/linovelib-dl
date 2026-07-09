import { cleanText, decodeHtml, matchFirst } from "./html.js";
import { restoreParagraphOrder } from "./obfuscation.js";
import { absolutizeUrl } from "./html.js";
import { ChapterPage, ContentNode, ReadParams } from "./types.js";

export function parseChapterPage(html: string, pageUrl: string): ChapterPage {
  if (isDegradedReaderPage(html)) {
    throw new Error(`degraded reader page: ${pageUrl}`);
  }

  const readParams = parseReadParams(html);
  const contentHtml = extractAcontentHtml(html);
  const nodes = parseContentNodes(contentHtml);
  const restoredNodes = restoreParagraphOrder(nodes, readParams.chapterid);
  const lines = extractTextLines(restoredNodes);

  return {
    url: pageUrl,
    title: cleanText(matchFirst(html, /<h1\b[^>]*id=["']atitle["'][^>]*>([\s\S]*?)<\/h1>/i)),
    volumeTitle: cleanText(matchFirst(html, /<div\b[^>]*class=["'][^"']*\batitle\b[^"']*["'][^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>/i)),
    readParams,
    previousUrl: readParams.url_previous ? absolutizeUrl(readParams.url_previous, pageUrl) : null,
    nextUrl: readParams.url_next ? absolutizeUrl(readParams.url_next, pageUrl) : null,
    indexUrl: readParams.url_index ? absolutizeUrl(readParams.url_index, pageUrl) : null,
    nextLinkLabel: extractNextLinkLabel(html),
    lines,
    text: lines.join("\n").trim(),
  };
}

function parseReadParams(html: string): ReadParams {
  const body = matchFirst(html, /var\s+ReadParams\s*=\s*\{([\s\S]*?)\}\s*;?\s*<\/script>/i);
  if (!body) {
    throw new Error("missing ReadParams");
  }

  const params: ReadParams = {};
  const pairPattern = /([A-Za-z_][\w]*)\s*:\s*(?:"([^"]*)"|'([^']*)')\s*,?/g;

  for (const match of body.matchAll(pairPattern)) {
    const key = match[1];
    if (key) {
      params[key] = decodeHtml(match[2] ?? match[3] ?? "");
    }
  }

  return params;
}

function extractAcontentHtml(html: string): string {
  const startMatch = /<div\b[^>]*id=["']acontent["'][^>]*>/i.exec(html);
  if (!startMatch) {
    throw new Error("missing #acontent");
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const endIndex = findClosingDiv(html, startIndex);
  return html.slice(startIndex, endIndex);
}

function findClosingDiv(html: string, startIndex: number): number {
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

function parseContentNodes(contentHtml: string): ContentNode[] {
  const nodes: ContentNode[] = [];
  const nodePattern =
    /<p\b[^>]*>[\s\S]*?<\/p>|<center\b[^>]*>[\s\S]*?<\/center>|<img\b[^>]*>|<br\b[^>]*>/gi;

  for (const match of contentHtml.matchAll(nodePattern)) {
    const raw = match[0];
    const type = raw.slice(1).match(/^\w+/)?.[0]?.toLowerCase();

    if (type === "img") {
      nodes.push({ type, raw, src: decodeHtml(matchFirst(raw, /\bsrc=["']([^"']+)["']/i)) });
    } else if (type === "br") {
      nodes.push({ type, raw });
    } else if (type === "p" || type === "center") {
      nodes.push({ type, raw, text: cleanText(raw) });
    }
  }

  return nodes;
}

function extractTextLines(nodes: ContentNode[]): string[] {
  const lines: string[] = [];

  for (const node of nodes) {
    if (node.type === "br") {
      appendBlank(lines);
      continue;
    }

    if (node.type === "img" && node.src) {
      appendText(lines, node.src);
      continue;
    }

    if ((node.type === "p" || node.type === "center") && node.text) {
      appendText(lines, node.text);
    }
  }

  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function extractNextLinkLabel(html: string): string {
  const footlinkHtml = matchFirst(html, /<div\b[^>]*id=["']footlink["'][^>]*>([\s\S]*?)<\/div>/i);
  return cleanText(matchFirst(footlinkHtml, /<a\b[^>]*class=["'][^"']*\bnextlink\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i));
}

function appendText(lines: string[], value: string): void {
  const text = value.trim();
  if (text) {
    lines.push(text);
  }
}

function appendBlank(lines: string[]): void {
  if (lines.length > 0 && lines.at(-1) !== "") {
    lines.push("");
  }
}

function isDegradedReaderPage(html: string): boolean {
  return html.includes("內容加載失敗") || html.includes("暫不支持電腦端閱讀");
}
