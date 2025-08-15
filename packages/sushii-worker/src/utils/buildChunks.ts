export default function buildChunks(
  strings: string[],
  joiner: string,
  maxChunkLength: number,
): string[] {
  const chunks: string[] = [];

  let currentChunk = "";

  for (const str of strings) {
    // This will exceed the chunk limit, so finalize the chunk and create a new
    // current chunk
    if (currentChunk.length + str.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    if (currentChunk === "") {
      currentChunk = str;
    } else {
      // Only add joiner if chunk is non-empty
      currentChunk += joiner + str;
    }
  }

  // Still anything leftover, create a new chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
