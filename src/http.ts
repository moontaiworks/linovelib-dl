const READER_COOKIE = "night=0";
const IMAGE_REFERER = "https://tw.linovelib.com/";

export interface FetchLinovelHtmlOptions extends RequestInit {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export interface FetchBinaryResult {
  content: Buffer;
  mediaType?: string;
}

export function createLinovelHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
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

export function createLinovelImageHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  if (findHeaderKey(headers, "referer")) {
    return { ...headers };
  }

  return {
    ...headers,
    Referer: IMAGE_REFERER,
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
  console.debug(`Fetched HTML with ${response.status} from ${url}`);

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

export async function fetchLinovelBinary(
  url: string,
  options: FetchLinovelHtmlOptions = {},
): Promise<FetchBinaryResult> {
  const { fetchImpl = fetch, headers, ...requestOptions } = options;
  const response = await fetchImpl(url, {
    ...requestOptions,
    headers: createLinovelImageHeaders(headers),
  });

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }

  const mediaType = response.headers.get("content-type") ?? undefined;
  console.debug(`Fetched ${mediaType} from ${url}`);

  return {
    content: Buffer.from(await response.arrayBuffer()),
    mediaType,
  };
}

export interface ThrottledFetchHtmlOptions {
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function createThrottledFetchHtml(
  fetchHtml: (url: string) => Promise<string>,
  options: ThrottledFetchHtmlOptions = {},
): (url: string) => Promise<string> {
  return createThrottledFetch(fetchHtml, options);
}

export function createThrottledFetchBinary(
  fetchBinary: (url: string) => Promise<FetchBinaryResult>,
  options: ThrottledFetchHtmlOptions = {},
): (url: string) => Promise<FetchBinaryResult> {
  return createThrottledFetch(fetchBinary, options);
}

function createThrottledFetch<T>(
  fetchValue: (url: string) => Promise<T>,
  options: ThrottledFetchHtmlOptions = {},
): (url: string) => Promise<T> {
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let nextAllowedAt = 0;

  return async (url: string) => {
    const waitMs = Math.max(0, nextAllowedAt - now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    nextAllowedAt = now() + intervalMs;
    return fetchValue(url);
  };
}

function findHeaderKey(
  headers: Record<string, string>,
  wantedKey: string,
): string | undefined {
  const lowerWantedKey = wantedKey.toLowerCase();
  return Object.keys(headers).find(
    (key) => key.toLowerCase() === lowerWantedKey,
  );
}

function hasCookie(cookieHeader: string | undefined, name: string): boolean {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(";")
    .some((cookie) =>
      cookie.trim().toLowerCase().startsWith(`${name.toLowerCase()}=`),
    );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
