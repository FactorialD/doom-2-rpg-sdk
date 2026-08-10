import { MidiEvent, MidiNoteEvent, MidiTempoEvent, MidiTrack, NormalizedMidiNote, ParsedMidi } from './midi-types';

const textDecoder = new TextDecoder('windows-1252');

class Reader {
  readonly view: DataView;
  position = 0;
  constructor(buffer: ArrayBuffer) { this.view = new DataView(buffer); }
  get remaining() { return this.view.byteLength - this.position; }
  require(length: number, what: string) { if (length < 0 || this.position + length > this.view.byteLength) throw new RangeError(`Truncated MIDI while reading ${what}`); }
  u8(what = 'byte') { this.require(1, what); return this.view.getUint8(this.position++); }
  u16(what = '16-bit value') { this.require(2, what); const value = this.view.getUint16(this.position, false); this.position += 2; return value; }
  u32(what = '32-bit value') { this.require(4, what); const value = this.view.getUint32(this.position, false); this.position += 4; return value; }
  ascii(length: number) { this.require(length, 'chunk signature'); let result = ''; while (length--) result += String.fromCharCode(this.u8()); return result; }
  bytes(length: number, what: string) { this.require(length, what); const result = new Uint8Array(this.view.buffer, this.view.byteOffset + this.position, length); this.position += length; return result; }
  vlq() { let value = 0; for (let i = 0; i < 4; i++) { const byte = this.u8('variable-length quantity'); value = value * 128 + (byte & 0x7f); if (!(byte & 0x80)) return value; } throw new Error('Invalid MIDI variable-length quantity (more than 4 bytes)'); }
}

function tickConverter(tempos: MidiTempoEvent[], division: number) {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
  const effective: MidiTempoEvent[] = [{ type: 'tempo', tick: 0, timeSeconds: 0, microsecondsPerQuarterNote: 500000 }];
  for (const tempo of sorted) {
    const last = effective[effective.length - 1];
    if (tempo.tick === last.tick) effective[effective.length - 1] = { ...tempo };
    else effective.push({ ...tempo });
  }
  let seconds = 0;
  for (let i = 0; i < effective.length; i++) {
    if (i) seconds += (effective[i].tick - effective[i - 1].tick) * effective[i - 1].microsecondsPerQuarterNote / division / 1_000_000;
    effective[i].timeSeconds = seconds;
  }
  return { map: effective, convert(tick: number) { let tempo = effective[0]; for (const candidate of effective) { if (candidate.tick > tick) break; tempo = candidate; } return tempo.timeSeconds + (tick - tempo.tick) * tempo.microsecondsPerQuarterNote / division / 1_000_000; } };
}

export function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const reader = new Reader(buffer);
  if (reader.ascii(4) !== 'MThd') throw new Error('Invalid MIDI: missing MThd header');
  const headerLength = reader.u32('MThd length');
  if (headerLength < 6) throw new Error(`Invalid MIDI header length: ${headerLength}`);
  reader.require(headerLength, 'MThd data');
  const format = reader.u16('MIDI format');
  const trackCount = reader.u16('track count');
  const division = reader.u16('time division');
  if (format !== 0 && format !== 1) throw new Error(`Unsupported MIDI format ${format}; only format 0 and 1 are supported`);
  if (format === 0 && trackCount !== 1) throw new Error('Invalid format 0 MIDI: expected exactly one track');
  if (division & 0x8000) throw new Error('SMPTE MIDI time division is not supported');
  if (!division) throw new Error('Invalid MIDI time division: zero ticks per quarter note');
  reader.position = 8 + headerLength;
  const tracks: MidiTrack[] = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
    if (reader.ascii(4) !== 'MTrk') throw new Error(`Invalid MIDI: missing MTrk signature for track ${trackIndex + 1}`);
    const length = reader.u32('MTrk length'); reader.require(length, 'MTrk data');
    const end = reader.position + length; const events: MidiEvent[] = []; let tick = 0; let runningStatus: number | null = null; let name: string | undefined;
    while (reader.position < end) {
      tick += reader.vlq();
      let first = reader.u8('event status'); let status: number;
      if (first < 0x80) { if (runningStatus === null) throw new Error(`Running status without prior channel status in track ${trackIndex + 1}`); status = runningStatus; }
      else { status = first; first = -1; if (status < 0xf0) runningStatus = status; else runningStatus = null; }
      const data = () => first >= 0 ? (first < 0x80 ? (status = status, first) : 0) : reader.u8('event data');
      if (status === 0xff) {
        const metaType = reader.u8('meta event type'); const size = reader.vlq(); reader.require(size, 'meta event');
        if (metaType === 0x51) { if (size !== 3) throw new Error('Invalid Set Tempo event length'); const bytes = reader.bytes(3, 'tempo'); events.push({ type: 'tempo', tick, timeSeconds: 0, microsecondsPerQuarterNote: bytes[0] * 65536 + bytes[1] * 256 + bytes[2] }); }
        else if (metaType === 0x2f) { if (size !== 0) throw new Error('Invalid End of Track event length'); events.push({ type: 'endOfTrack', tick, timeSeconds: 0 }); }
        else if (metaType === 0x03) { name = textDecoder.decode(reader.bytes(size, 'track name')); events.push({ type: 'trackName', tick, timeSeconds: 0, name }); }
        else reader.bytes(size, 'unknown meta event');
      } else if (status === 0xf0 || status === 0xf7) { const size = reader.vlq(); reader.bytes(size, 'SysEx event'); }
      else {
        const type = status & 0xf0; const channel = status & 0x0f; const a = data();
        if (a >= 0x80) throw new Error('Invalid MIDI channel event data byte');
        if (type === 0xc0) events.push({ type: 'programChange', tick, timeSeconds: 0, channel, program: a });
        else if (type === 0xd0) { /* channel pressure */ }
        else { const b = reader.u8('event data'); if (b >= 0x80) throw new Error('Invalid MIDI channel event data byte');
          if (type === 0x80 || type === 0x90) events.push({ type: type === 0x80 || b === 0 ? 'noteOff' : 'noteOn', tick, timeSeconds: 0, channel, note: a, velocity: b });
          else if (type === 0xb0) events.push({ type: 'controlChange', tick, timeSeconds: 0, channel, controller: a, value: b });
          else if (type === 0xe0) events.push({ type: 'pitchBend', tick, timeSeconds: 0, channel, value: (b << 7) | a });
          else if (type !== 0xa0) throw new Error(`Unsupported MIDI status 0x${status.toString(16)}`);
        }
      }
      if (reader.position > end) throw new RangeError(`MIDI event exceeds track ${trackIndex + 1} chunk length`);
    }
    if (reader.position !== end) throw new RangeError(`Invalid track ${trackIndex + 1} chunk length`);
    tracks.push({ name, events, endTick: tick });
  }
  const tempos = tracks.flatMap(track => track.events.filter((event): event is MidiTempoEvent => event.type === 'tempo'));
  const timing = tickConverter(tempos, division);
  for (const track of tracks) for (const event of track.events) event.timeSeconds = timing.convert(event.tick);
  const notes: NormalizedMidiNote[] = []; const active = new Map<string, MidiNoteEvent[]>();
  const ordered = tracks.flatMap(track => track.events).filter((event): event is MidiNoteEvent => event.type === 'noteOn' || event.type === 'noteOff').sort((a, b) => a.tick - b.tick || (a.type === 'noteOff' ? -1 : 1));
  for (const event of ordered) { const key = `${event.channel}:${event.note}`; const stack = active.get(key) ?? []; if (event.type === 'noteOn') { stack.push(event); active.set(key, stack); } else { const on = stack.shift(); if (on) notes.push({ channel: on.channel, note: on.note, velocity: on.velocity, startTick: on.tick, endTick: event.tick, startSeconds: on.timeSeconds, endSeconds: event.timeSeconds }); } }
  const maxTick = Math.max(0, ...tracks.map(track => track.endTick)); const durationSeconds = timing.convert(maxTick);
  for (const stack of active.values()) for (const on of stack) notes.push({ channel: on.channel, note: on.note, velocity: on.velocity, startTick: on.tick, endTick: maxTick, startSeconds: on.timeSeconds, endSeconds: durationSeconds });
  notes.sort((a, b) => a.startSeconds - b.startSeconds);
  return { header: { format: format as 0 | 1, trackCount, ticksPerQuarterNote: division }, tracks, tempoMap: timing.map, notes, durationSeconds };
}
