import assert from 'node:assert/strict';
import test from 'node:test';
import { extractIndexedSoundMetadata, extractSoundMetadata } from './doom-sound-metadata';

const buffer = (...bytes: number[]) => Uint8Array.from(bytes).buffer;
const ascii = (value: string) => [...value].map(character => character.charCodeAt(0));

test('extracts a static MIDI duration', () => {
  const midi = buffer(
    ...ascii('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    ...ascii('MTrk'), 0, 0, 0, 8, 0, 0x90, 60, 100, 0x60, 0xff, 0x2f, 0
  );
  assert.deepEqual(extractSoundMetadata(midi), { format: 'midi', durationSeconds: 0.5, error: null });
});

test('extracts WAV duration from the data chunk and byte rate', () => {
  const wav = new ArrayBuffer(48); const view = new DataView(wav); const bytes = new Uint8Array(wav);
  bytes.set(ascii('RIFF')); view.setUint32(4, 40, true); bytes.set(ascii('WAVEfmt '), 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8, true); view.setUint32(28, 8, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true); bytes.set(ascii('data'), 36); view.setUint32(40, 4, true);
  assert.deepEqual(extractSoundMetadata(wav), { format: 'wav', durationSeconds: 0.5, error: null });
});

test('extracts big-endian AU PCM duration', () => {
  const au = new ArrayBuffer(32); const view = new DataView(au); new Uint8Array(au).set(ascii('.snd'));
  view.setUint32(4, 24, false); view.setUint32(8, 8, false); view.setUint32(12, 3, false);
  view.setUint32(16, 2, false); view.setUint32(20, 1, false);
  assert.deepEqual(extractSoundMetadata(au), { format: 'au', durationSeconds: 2, error: null });
});

test('marks truncated recognized headers as unavailable', () => {
  for (const [signature, format] of [['MThd', 'midi'], ['RIFF', 'wav'], ['.snd', 'au']] as const) {
    const metadata = extractSoundMetadata(buffer(...ascii(signature)));
    assert.equal(metadata.format, format); assert.equal(metadata.durationSeconds, null); assert.ok(metadata.error);
  }
});

test('isolates invalid index entries from other metadata extraction', () => {
  const source = buffer(...ascii('unknown data'));
  const invalid = extractIndexedSoundMetadata({ fileId: 0, offset: 99, length: 4 }, source);
  assert.equal(invalid.durationSeconds, null); assert.match(invalid.error!, /outside/);
  assert.equal(extractIndexedSoundMetadata({ fileId: 0, offset: 0, length: 4 }, source).format, 'unknown');
});
