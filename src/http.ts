const READER_COOKIE = "night=0";
const IMAGE_REFERER = "https://tw.linovelib.com/";
export const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

export interface FetchLinovelHtmlOptions extends RequestInit {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  rateLimitDefaultMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
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
  const response = await fetchWithRateLimitRetry(url, fetchImpl, {
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
  const response = await fetchWithRateLimitRetry(url, fetchImpl, {
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

interface RateLimitRetryOptions extends RequestInit {
  rateLimitDefaultMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

async function fetchWithRateLimitRetry(
  url: string,
  fetchImpl: typeof fetch,
  options: RateLimitRetryOptions,
): Promise<Response> {
  const {
    rateLimitDefaultMs = DEFAULT_RATE_LIMIT_WAIT_MS,
    now = Date.now,
    sleep = defaultSleep,
    ...requestOptions
  } = options;

  const response = await fetchImpl(url, requestOptions);
  if (response.status !== 429) {
    return response;
  }

  const waitMs = getRateLimitWaitMs(
    response.headers,
    now(),
    rateLimitDefaultMs,
  );
  console.debug(`Rate limited with 429 from ${url}; retrying in ${waitMs}ms`);
  await response.body?.cancel();
  await sleep(waitMs);

  return fetchWithRateLimitRetry(url, fetchImpl, options);
}

function getRateLimitWaitMs(
  headers: Headers,
  nowMs: number,
  defaultMs: number,
): number {
  const retryAfter = headers.get("retry-after");
  const retryAfterMs = parseRetryAfter(retryAfter, nowMs);
  if (retryAfterMs !== undefined) {
    console.debug(
      `Rate limit retry-after header: ${retryAfter} => ${retryAfterMs}ms`,
    );
    return retryAfterMs;
  }

  for (const name of ["ratelimit-reset", "x-ratelimit-reset"]) {
    const resetMs = parseRateLimitReset(headers.get(name), nowMs);
    if (resetMs !== undefined) {
      console.debug(
        `Rate limit ${name} header: ${headers.get(name)} => ${resetMs}ms`,
      );
      return resetMs;
    }
  }

  return Math.max(0, defaultMs);
}

function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - nowMs);
}

function parseRateLimitReset(
  value: string | null,
  nowMs: number,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) {
    const resetAtMs =
      number >= 1_000_000_000_000
        ? number
        : number >= 1_000_000_000
          ? number * 1000
          : nowMs + number * 1000;
    return Math.max(0, resetAtMs - nowMs);
  }

  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - nowMs);
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
