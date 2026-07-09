import { parseArgs } from "node:util";

export type CliOptions =
  | { command: "help" }
  | {
      command: "download";
      bookId: string;
      chapterId?: string;
      maxPages?: number;
    };

export function parseCliOptions(args: string[]): CliOptions {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      "book-id": { type: "string", short: "b" },
      "chapter-id": { type: "string", short: "c" },
      "max-pages": { type: "string" },
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
    maxPages: parseMaxPages(parsed.values["max-pages"]),
  };

  if (parsed.values["chapter-id"]) {
    options.chapterId = parsed.values["chapter-id"];
  }

  if (options.maxPages === undefined) {
    delete options.maxPages;
  }

  return options;
}

export function formatCliHelp(): string {
  return [
    "Usage:",
    "  linovel-dl --book-id <bookId> [options]",
    "",
    "Options:",
    "  -b, --book-id <bookId>        Download a whole book from its catalog",
    "  -c, --chapter-id <chapterId>  Start from a specific chapter id",
    "  -m, --max-pages <count>       Stop after count pages, useful for testing",
    "  -h, --help                    Show this help",
    "",
    "Examples:",
    "  linovel-dl --book-id 2013 --max-pages 3",
    "  linovel-dl --book-id 2013 --chapter-id 72034",
  ].join("\n");
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
