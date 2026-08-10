import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidi } from './midi-parser.ts';

const be16 = (value: number) => [value >> 8, value & 255];
const be32 = (value: number) => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const vlq = (value: number) => { const bytes = [value & 0x7f]; while (value >>= 7) bytes.unshift((value & 0x7f) | 0x80); return bytes; };
function midi(format: 0 | 1, division: number, ...tracks: number[][]) {
  return new Uint8Array([...'MThd'].map(c => c.charCodeAt(0)).concat(be32(6), be16(format), be16(tracks.length), be16(division), ...tracks.flatMap(data => [...'MTrk'].map(c => c.charCodeAt(0)).concat(be32(data.length), data)))).buffer;
}

test('format 0 parses running status, velocity-zero note off, VLQ and unknown events', () => {
  const track = [
    0, 0x90, 60, 100,
    ...vlq(128), 62, 80,
    0, 60, 0,
    0, 0xff, 0x01, 3, 65, 66, 67,
    0, 0xf0, 2, 1, 2,
    ...vlq(128), 0x80, 62, 64,
    0, 0xff, 0x2f, 0
  ];
  const result = parseMidi(midi(0, 128, track));
  assert.equal(result.notes.length, 2);
  assert.deepEqual(result.notes.map(note => [note.note, note.startTick, note.endTick]), [[60, 0, 128], [62, 128, 256]]);
  assert.equal(result.durationSeconds, 1);
});

test('format 1 uses the shared tempo map and exposes track names and channel events', () => {
  const tempo = [0, 0xff, 0x03, 5, ...Buffer.from('Tempo'), 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, ...vlq(480), 0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0, 0xff, 0x2f, 0];
  const notes = [0, 0xc2, 40, 0, 0xb2, 7, 100, 0, 0xe2, 0, 64, 0, 0x92, 64, 127, ...vlq(960), 0x82, 64, 0, 0, 0xff, 0x2f, 0];
  const result = parseMidi(midi(1, 480, tempo, notes));
  assert.equal(result.tracks[0].name, 'Tempo');
  assert.equal(result.tempoMap.length, 2);
  assert.equal(result.notes[0].endSeconds, 1.5); // 0.5 s at 500,000 µs/qn + 1 s at 1,000,000 µs/qn
  assert.equal(result.durationSeconds, 1.5);
  assert.deepEqual(result.tracks[1].events.slice(0, 3).map(event => event.type), ['programChange', 'controlChange', 'pitchBend']);
});

test('rejects invalid signatures, SMPTE division, malformed VLQ and truncated chunks', () => {
  assert.throws(() => parseMidi(new Uint8Array(14).buffer), /MThd/);
  assert.throws(() => parseMidi(midi(0, 0xe728, [0, 0xff, 0x2f, 0])), /SMPTE/);
  assert.throws(() => parseMidi(midi(0, 96, [0x81, 0x81, 0x81, 0x81, 0])), /variable-length/);
  const truncated = new Uint8Array(midi(0, 96, [0, 0x90, 60, 100]));
  new DataView(truncated.buffer).setUint32(18, 99, false);
  assert.throws(() => parseMidi(truncated.buffer), /Truncated MIDI/);
});
