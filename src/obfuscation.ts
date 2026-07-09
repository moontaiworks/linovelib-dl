import { ContentNode } from "./types.js";

const FIXED_PARAGRAPH_COUNT = 20;

export function restoreParagraphOrder(nodes: ContentNode[], chapterId: string | undefined): ContentNode[] {
  const paragraphs = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "p" && textPayload(node).replace(/\s+/g, "").length > 0);

  if (paragraphs.length === 0 || !chapterId) {
    return nodes;
  }

  const order = createParagraphOrder(paragraphs.length, chapterId);
  const restoredParagraphs: ContentNode[] = [];

  for (let index = 0; index < paragraphs.length; index++) {
    const targetIndex = order[index];
    if (targetIndex !== undefined) {
      restoredParagraphs[targetIndex] = paragraphs[index]!.node;
    }
  }

  const restoredNodes = nodes.slice();
  let paragraphIndex = 0;
  for (const { index } of paragraphs) {
    const restored = restoredParagraphs[paragraphIndex];
    if (restored) {
      restoredNodes[index] = restored;
    }
    paragraphIndex++;
  }

  return restoredNodes;
}

export function createParagraphOrder(length: number, chapterId: string): number[] {
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

function seededShuffle(values: number[], seed: number): number[] {
  const shuffled = values.slice();
  let state = Number(seed);

  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (state * 9302 + 49397) % 233280;
    const target = Math.floor((state / 233280) * (index + 1));
    const currentValue = shuffled[index]!;
    shuffled[index] = shuffled[target]!;
    shuffled[target] = currentValue;
  }

  return shuffled;
}

function createChapterSeed(chapterId: string): number {
  return Number(chapterId) * 126 + 232;
}

function textPayload(node: ContentNode): string {
  return node.text ?? "";
}
