import { DEFAULT_BASE_URL } from "./types.js";

export function absolutizeUrl(url: string, baseUrl: string = DEFAULT_BASE_URL): string {
  return new URL(url, baseUrl).href;
}

export function matchFirst(value: string, pattern: RegExp): string {
  return pattern.exec(value)?.[1] ?? "";
}

export function cleanText(html: string): string {
  return decodeHtml(stripTags(html))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

export function stripTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "");
}

export function decodeHtml(value = ""): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    apos: "'",
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
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
