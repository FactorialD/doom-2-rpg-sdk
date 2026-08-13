/** One logical entry returned by Resource.loadFileIndex(). */
export interface ResourceFileIndexEntry {
  fileId: number;
  offset: number;
  length: number;
}

const HEADER_SIZE = 2;
const RECORD_SIZE = 5;
const SKIP_FILE_ID = 0xff;

/**
 * Parses the index shared by sounds.idx, strings.idx, images.idx, and similar
 * resources. The header counts logical entries; 0xff records are physical
 * file-boundary markers and therefore do not consume that count.
 */
export function parseResourceFileIndex(buffer: ArrayBuffer): ResourceFileIndexEntry[] {
  const view = new DataView(buffer);
  if (view.byteLength < HEADER_SIZE) {
    throw new RangeError('Resource index is missing its entry count');
  }

  const expectedCount = view.getInt16(0, true);
  if (expectedCount < 0) {
    throw new RangeError(`Resource index has a negative entry count: ${expectedCount}`);
  }

  const entries: ResourceFileIndexEntry[] = [];
  let position = HEADER_SIZE;

  while (entries.length < expectedCount) {
    // The final five bytes are the footer, not a logical/physical entry.
    if (position + RECORD_SIZE * 2 > view.byteLength) {
      throw new RangeError('Resource index ended before all logical entries were read');
    }

    const fileId = view.getUint8(position);
    const offset = view.getInt32(position + 1, true);
    position += RECORD_SIZE;

    // Resource.loadFileIndex uses every non-zero physical offset (including a
    // 0xff boundary marker) to close the preceding logical entry.
    if (offset !== 0 && entries.length > 0) {
      const previous = entries[entries.length - 1];
      previous.length = offset - previous.offset;
    }

    if (fileId !== SKIP_FILE_ID) {
      entries.push({ fileId, offset, length: 0 });
    }
  }

  if (position + RECORD_SIZE > view.byteLength) {
    throw new RangeError('Resource index is missing its footer');
  }

  // The footer's file ID is ignored by the original implementation.
  const finalOffset = view.getInt32(position + 1, true);
  if (entries.length > 0) {
    const last = entries[entries.length - 1];
    last.length = finalOffset - last.offset;
  }

  return entries;
}

export function flattenResourceFileIndex(entries: readonly ResourceFileIndexEntry[]): Int32Array<ArrayBuffer> {
  const result = new Int32Array(entries.length * 3);
  entries.forEach((entry, index) => {
    result[index * 3] = entry.fileId;
    result[index * 3 + 1] = entry.offset;
    result[index * 3 + 2] = entry.length;
  });
  return result;
}

/** Writes the exact record layout consumed by Resource.loadFileIndex(). */
export function serializeResourceFileIndex(entries: readonly ResourceFileIndexEntry[]): ArrayBuffer {
  const boundaries = entries.slice(1).filter((entry, index) => entry.fileId !== entries[index].fileId).length;
  const buffer = new ArrayBuffer(HEADER_SIZE + (entries.length + boundaries + 1) * RECORD_SIZE);
  const view = new DataView(buffer);
  view.setInt16(0, entries.length, true);
  let position = HEADER_SIZE;
  entries.forEach((entry, index) => {
    view.setUint8(position, entry.fileId);
    view.setInt32(position + 1, entry.offset, true);
    position += RECORD_SIZE;
    const next = entries[index + 1];
    if (next && next.fileId !== entry.fileId) {
      view.setUint8(position, SKIP_FILE_ID);
      view.setInt32(position + 1, entry.offset + entry.length, true);
      position += RECORD_SIZE;
    }
  });
  const last = entries.at(-1);
  view.setUint8(position, SKIP_FILE_ID);
  view.setInt32(position + 1, last ? last.offset + last.length : 0, true);
  return buffer;
}
