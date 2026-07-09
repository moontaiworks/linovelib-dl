import { parseArgs } from "node:util";

export type CliOptions =
  | { command: "help" }
  | {
      command: "download";
      bookId: string;
      chapterId?: string;
      volumeId?: string;
      format: "json" | "epub";
      output?: string;
      maxPages?: number;
      requestIntervalMs: number;
    };

export function parseCliOptions(args: string[]): CliOptions {
  const parsed = parseArgs({
    args: normalizeOptionValues(
      args,
      new Set(["--max-pages", "--request-interval-ms"]),
    ),
    allowPositionals: false,
    options: {
      "book-id": { type: "string", short: "b" },
      "chapter-id": { type: "string", short: "c" },
      "volume-id": { type: "string" },
      format: { type: "string" },
      output: { type: "string", short: "o" },
      "max-pages": { type: "string" },
      "request-interval-ms": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (parsed.values.help) {
    return { command: "help" };
  }

  const bookId = parsed.values["book-id"];
  if (!bookId) {
    throw new Error("Missing required option: --book-id");
  }

  const options: CliOptions = {
    command: "download",
    bookId,
    format: parseFormat(parsed.values.format),
    maxPages: parseMaxPages(parsed.values["max-pages"]),
    requestIntervalMs: parseRequestIntervalMs(
      parsed.values["request-interval-ms"],
    ),
  };

  if (parsed.values["chapter-id"]) {
    options.chapterId = parsed.values["chapter-id"];
  }

  if (parsed.values["volume-id"]) {
    options.volumeId = parsed.values["volume-id"];
  }

  if (parsed.values.output) {
    options.output = parsed.values.output;
  }

  if (options.format === "epub" && options.chapterId) {
    throw new Error("--chapter-id cannot be used with --format epub");
  }

  if (options.format === "epub" && !options.output) {
    throw new Error("--output is required when --format epub");
  }

  if (options.maxPages === undefined) {
    delete options.maxPages;
  }

  return options;
}

export function formatCliHelp(): string {
  return [
    "Usage:",
    "  linovellib-dl --book-id <bookId> [options]",
    "",
    "Options:",
    "  -b, --book-id <bookId>        Download a whole book from its catalog",
    "  -c, --chapter-id <chapterId>  Start from a specific chapter id",
    "      --volume-id <volumeId>    Limit EPUB output to one catalog volume",
    "      --format <json|epub>      Output format (default: json)",
    "  -o, --output <dir>            Output directory for EPUB files",
    "      --max-pages <count>       Stop after count pages, useful for testing",
    "      --request-interval-ms <ms> Wait at least ms between requests (default: 250)",
    "  -h, --help                    Show this help",
    "",
    "Examples:",
    "  linovellib-dl --book-id 2013 --max-pages 3",
    "  linovellib-dl --book-id 2013 --chapter-id 72034 --request-interval-ms 500",
    "  linovellib-dl --book-id 2013 --volume-id 72033 --format epub --output books",
  ].join("\n");
}

function parseFormat(value: string | undefined): "json" | "epub" {
  if (!value) {
    return "json";
  }

  if (value !== "json" && value !== "epub") {
    throw new Error("--format must be either json or epub");
  }

  return value;
}

function parseMaxPages(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const maxPages = Number(value);
  if (!Number.isInteger(maxPages) || maxPages <= 0) {
    throw new Error("--max-pages must be a positive integer");
  }

  return maxPages;
}

function parseRequestIntervalMs(value: string | undefined): number {
  if (!value) {
    return 250;
  }

  const intervalMs = Number(value);
  if (!Number.isInteger(intervalMs) || intervalMs < 0) {
    throw new Error("--request-interval-ms must be a non-negative integer");
  }

  return intervalMs;
}

function normalizeOptionValues(
  args: string[],
  optionNames: Set<string>,
): string[] {
  const normalized: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    const next = args[index + 1];

    if (optionNames.has(value) && next?.startsWith("-")) {
      normalized.push(`${value}=${next}`);
      index++;
    } else {
      normalized.push(value);
    }
  }

  return normalized;
}
