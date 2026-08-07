export interface MidiHeader {
  format: 0 | 1;
  trackCount: number;
  ticksPerQuarterNote: number;
}

export interface MidiEventBase { tick: number; timeSeconds: number; }
export interface MidiNoteEvent extends MidiEventBase { type: 'noteOn' | 'noteOff'; channel: number; note: number; velocity: number; }
export interface MidiProgramChangeEvent extends MidiEventBase { type: 'programChange'; channel: number; program: number; }
export interface MidiControlChangeEvent extends MidiEventBase { type: 'controlChange'; channel: number; controller: number; value: number; }
export interface MidiPitchBendEvent extends MidiEventBase { type: 'pitchBend'; channel: number; value: number; }
export interface MidiTempoEvent extends MidiEventBase { type: 'tempo'; microsecondsPerQuarterNote: number; }
export interface MidiEndOfTrackEvent extends MidiEventBase { type: 'endOfTrack'; }
export interface MidiTrackNameEvent extends MidiEventBase { type: 'trackName'; name: string; }

export type MidiChannelEvent = MidiNoteEvent | MidiProgramChangeEvent | MidiControlChangeEvent | MidiPitchBendEvent;
export type MidiMetaEvent = MidiTempoEvent | MidiEndOfTrackEvent | MidiTrackNameEvent;
export type MidiEvent = MidiChannelEvent | MidiMetaEvent;

export interface MidiTrack { name?: string; events: MidiEvent[]; endTick: number; }
export interface NormalizedMidiNote { channel: number; note: number; velocity: number; startTick: number; endTick: number; startSeconds: number; endSeconds: number; }
export interface ParsedMidi { header: MidiHeader; tracks: MidiTrack[]; tempoMap: MidiTempoEvent[]; notes: NormalizedMidiNote[]; durationSeconds: number; }
