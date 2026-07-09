import * as cheerio from "cheerio";
import { decodeHtml } from "./html.js";
import { restoreParagraphOrder } from "./obfuscation.js";
import { absolutizeUrl } from "./html.js";
import { ChapterPage, ContentNode, ReadParams } from "./types.js";

export function parseChapterPage(html: string, pageUrl: string): ChapterPage {
  if (isDegradedReaderPage(html)) {
    throw new Error(`degraded reader page: ${pageUrl}`);
  }

  const $ = cheerio.load(html);
  const readParams = parseReadParams($);
  const nodes = parseContentNodes($);
  const restoredNodes = restoreParagraphOrder(nodes, readParams.chapterid);
  const content = absolutizeContentUrls(restoredNodes, pageUrl);
  const lines = extractTextLines(content);

  return {
    url: pageUrl,
    title: normalizeDomText($("#atitle").first().text()),
    volumeTitle: normalizeDomText($(".atitle h3").first().text()),
    readParams,
    previousUrl: readParams.url_previous ? absolutizeUrl(readParams.url_previous, pageUrl) : null,
    nextUrl: readParams.url_next ? absolutizeUrl(readParams.url_next, pageUrl) : null,
    indexUrl: readParams.url_index ? absolutizeUrl(readParams.url_index, pageUrl) : null,
    nextLinkLabel: normalizeDomText($("#footlink .nextlink").first().text()),
    content,
    lines,
    text: lines.join("\n").trim(),
  };
}

function parseReadParams($: cheerio.CheerioAPI): ReadParams {
  const scriptText =
    $("script")
      .toArray()
      .map((script) => $(script).html() ?? "")
      .find((text) => text.includes("ReadParams")) ?? "";
  const body = /var\s+ReadParams\s*=\s*\{([\s\S]*?)\}\s*;?/i.exec(scriptText)?.[1] ?? "";

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

function parseContentNodes($: cheerio.CheerioAPI): ContentNode[] {
  const content = $("#acontent").first();
  if (content.length === 0) {
    throw new Error("missing #acontent");
  }

  const nodes: ContentNode[] = [];

  for (const node of content.contents().toArray()) {
    const element = $(node);
    const type = element.prop("tagName")?.toLowerCase();
    const raw = element.toString();

    if (type === "img") {
      nodes.push({ type, raw, src: element.attr("data-src") ?? element.attr("src") ?? "" });
    } else if (type === "br") {
      nodes.push({ type, raw });
    } else if (type === "p" || type === "center") {
      nodes.push({ type, raw, text: normalizeDomText(element.text()) });
    }
  }

  return nodes;
}

function absolutizeContentUrls(nodes: ContentNode[], pageUrl: string): ContentNode[] {
  return nodes.map((node) => {
    if (node.type !== "img" || !node.src) {
      return node;
    }

    return {
      ...node,
      src: absolutizeUrl(node.src, pageUrl),
    };
  });
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

function normalizeDomText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}
