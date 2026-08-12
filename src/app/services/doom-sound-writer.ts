import { parseResourceFileIndex, ResourceFileIndexEntry } from '../core/resource-file-index';
import { extractSoundMetadata } from './doom-sound-metadata';

export const SOUND_SPLIT_LIMIT = 32768;
export type ImportableSoundFormat = 'midi';

export interface WrittenSoundResources {
  index: ArrayBuffer;
  files: Map<string, ArrayBuffer>;
  entries: ResourceFileIndexEntry[];
}

export function validateImportableSound(buffer: ArrayBuffer): ImportableSoundFormat {
  const metadata = extractSoundMetadata(buffer);
  // Sound.SOUND_FORMAT and every Manager.createPlayer call use audio/midi.
  if (metadata.format !== 'midi') throw new Error('The Java runtime confirms audio/midi as the only importable sound format');
  if (metadata.error) throw new Error(`The ${metadata.format.toUpperCase()} resource cannot be decoded: ${metadata.error}`);
  return metadata.format;
}

/** Rebuilds logical sounds in order and emits Resource.loadFileIndex-compatible split markers. */
export function writeSoundResources(sounds: readonly ArrayBuffer[], splitLimit = SOUND_SPLIT_LIMIT): WrittenSoundResources {
  if (!Number.isInteger(splitLimit) || splitLimit < 1) throw new RangeError('Sound split limit must be a positive integer');
  const chunks: Uint8Array[] = [];
  const entries: ResourceFileIndexEntry[] = [];
  let fileId = 0;
  let current: number[] = [];
  for (const sound of sounds) {
    if (sound.byteLength <= 0) throw new RangeError('Sound resources cannot be empty');
    if (sound.byteLength > splitLimit) throw new RangeError(`A ${sound.byteLength}-byte sound exceeds the ${splitLimit}-byte split-file limit`);
    if (current.length && current.length + sound.byteLength > splitLimit) {
      chunks.push(Uint8Array.from(current)); current = []; fileId++;
    }
    entries.push({ fileId, offset: current.length, length: sound.byteLength });
    current.push(...new Uint8Array(sound));
  }
  if (current.length || sounds.length === 0) chunks.push(Uint8Array.from(current));

  const records: Array<{ fileId: number; offset: number }> = [];
  entries.forEach((entry, index) => {
    if (index && entry.fileId !== entries[index - 1].fileId) records.push({ fileId: 0xff, offset: chunks[entries[index - 1].fileId].byteLength });
    records.push({ fileId: entry.fileId, offset: entry.offset });
  });
  const footer = entries.length ? chunks[entries.at(-1)!.fileId].byteLength : 0;
  const index = new ArrayBuffer(2 + (records.length + 1) * 5);
  const view = new DataView(index); view.setInt16(0, entries.length, true);
  records.forEach((record, position) => { view.setUint8(2 + position * 5, record.fileId); view.setInt32(3 + position * 5, record.offset, true); });
  const footerOffset = 2 + records.length * 5; view.setUint8(footerOffset, fileId); view.setInt32(footerOffset + 1, footer, true);

  const reparsed = parseResourceFileIndex(index);
  if (JSON.stringify(reparsed) !== JSON.stringify(entries)) throw new Error('Internal sounds.idx verification failed after writing');
  const files = new Map<string, ArrayBuffer>();
  chunks.forEach((chunk, id) => {
    const buffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buffer).set(chunk);
    files.set(`sounds${id}.bin`, buffer);
  });
  return { index, files, entries };
}
