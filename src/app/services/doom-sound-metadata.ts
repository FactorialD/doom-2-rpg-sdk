import { ResourceFileIndexEntry } from '../core/resource-file-index';
import { parseMidi } from './midi/midi-parser';

export type SoundFormat = 'midi' | 'wav' | 'au' | 'unknown';
export interface SoundMetadata {
  readonly format: SoundFormat;
  readonly durationSeconds: number | null;
  readonly error: string | null;
}

const unavailable = (format: SoundFormat, error: unknown): SoundMetadata => ({
  format, durationSeconds: null, error: error instanceof Error ? error.message : String(error)
});

/** Reads duration without using a browser decoder or creating playback objects. */
export function extractSoundMetadata(buffer: ArrayBuffer): SoundMetadata {
  const bytes = new Uint8Array(buffer);
  const signature = (offset: number, value: string) => value.length <= bytes.length - offset
    && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  const format: SoundFormat = signature(0, 'MThd') ? 'midi' : signature(0, 'RIFF') ? 'wav'
    : signature(0, '.snd') ? 'au' : 'unknown';
  try {
    if (format === 'midi') return { format, durationSeconds: parseMidi(buffer).durationSeconds, error: null };
    const view = new DataView(buffer);
    if (format === 'wav') {
      if (view.byteLength < 12 || !signature(8, 'WAVE')) throw new Error('Invalid or truncated RIFF/WAVE header');
      let position = 12; let byteRate: number | null = null; let dataSize: number | null = null;
      while (position + 8 <= view.byteLength) {
        const size = view.getUint32(position + 4, true); const dataStart = position + 8;
        if (size > view.byteLength - dataStart) throw new Error('WAV chunk extends past the resource');
        if (signature(position, 'fmt ')) {
          if (size < 16) throw new Error('Invalid WAV fmt chunk');
          byteRate = view.getUint32(dataStart + 8, true);
        } else if (signature(position, 'data')) dataSize = size;
        position = dataStart + size + (size & 1);
      }
      if (!byteRate || dataSize === null) throw new Error('WAV is missing a valid fmt or data chunk');
      return { format, durationSeconds: dataSize / byteRate, error: null };
    }
    if (format === 'au') {
      if (view.byteLength < 24) throw new Error('Invalid or truncated AU header');
      const dataOffset = view.getUint32(4, false); const declaredSize = view.getUint32(8, false);
      const encoding = view.getUint32(12, false); const sampleRate = view.getUint32(16, false); const channels = view.getUint32(20, false);
      if (dataOffset < 24 || dataOffset > view.byteLength) throw new Error('Invalid AU data offset');
      const dataSize = declaredSize === 0xffffffff ? view.byteLength - dataOffset : declaredSize;
      if (dataSize > view.byteLength - dataOffset) throw new Error('AU data extends past the resource');
      const bytesPerSample = new Map([[2, 1], [3, 2], [4, 3], [5, 4]]).get(encoding);
      if (!bytesPerSample) throw new Error(`Unsupported AU encoding ${encoding}`);
      if (!sampleRate || !channels) throw new Error('Invalid AU sample rate or channel count');
      return { format, durationSeconds: dataSize / (sampleRate * channels * bytesPerSample), error: null };
    }
    return unavailable(format, 'Unsupported or unrecognized sound format');
  } catch (error) { return unavailable(format, error); }
}

export function extractIndexedSoundMetadata(entry: ResourceFileIndexEntry, source: ArrayBuffer | null): SoundMetadata {
  if (!source || entry.fileId < 0 || entry.offset < 0 || entry.length <= 0
    || entry.offset > source.byteLength - entry.length) {
    return unavailable('unknown', 'Index entry points outside its soundsNN.bin resource');
  }
  return extractSoundMetadata(source.slice(entry.offset, entry.offset + entry.length));
}

