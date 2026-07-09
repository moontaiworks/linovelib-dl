const READER_COOKIE = "night=0";

export interface FetchLinovelHtmlOptions extends RequestInit {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export function createLinovelHeaders(headers: Record<string, string> = {}): Record<string, string> {
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

export async function fetchLinovelHtml(
  url: string,
  options: FetchLinovelHtmlOptions = {},
): Promise<string> {
  const { fetchImpl = fetch, headers, ...requestOptions } = options;
  const response = await fetchImpl(url, {
    ...requestOptions,
    headers: createLinovelHeaders(headers),
  });

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

function findHeaderKey(headers: Record<string, string>, wantedKey: string): string | undefined {
  const lowerWantedKey = wantedKey.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lowerWantedKey);
}

function hasCookie(cookieHeader: string | undefined, name: string): boolean {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(";")
    .some((cookie) => cookie.trim().toLowerCase().startsWith(`${name.toLowerCase()}=`));
}
