import { Injectable, effect, inject, signal } from '@angular/core';
import { parseResourceFileIndex, ResourceFileIndexEntry } from '../core/resource-file-index';
import { DoomFileService } from './doom-file.service';
import { parseMidi } from './midi/midi-parser';
import { MidiSynthService } from './midi/midi-synth.service';
import { ParsedMidi } from './midi/midi-types';

export type SoundFormat = 'midi' | 'wav' | 'au' | 'unknown';

@Injectable({ providedIn: 'root' })
export class DoomSoundService {
  private readonly fileService = inject(DoomFileService);
  readonly synth = inject(MidiSynthService);
  private soundIndex: ResourceFileIndexEntry[] = [];
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  readonly soundIds = signal<readonly number[]>([]);
  readonly selectedSoundId = signal<number | null>(null);
  readonly playingSoundId = signal<number | null>(null);
  readonly playbackError = signal<string | null>(null);
  readonly loading = signal(false);
  readonly format = signal<SoundFormat | null>(null);
  readonly midiInfo = signal<ParsedMidi | null>(null);

  readonly state = this.synth.state;
  readonly positionSeconds = this.synth.positionSeconds;
  readonly durationSeconds = this.synth.durationSeconds;
  readonly volume = this.synth.volume;

  constructor() {
    effect(() => {
      if (this.fileService.isLoaded()) this.loadSoundsIndex();
      else this.resetAll();
    });
    effect(() => { if (this.synth.state() === 'ended' && this.format() === 'midi') this.playingSoundId.set(null); });
  }

  loadSoundsIndex() {
    this.stopSound(); this.clearSelection();
    const buffer = this.fileService.getFile('sounds.idx');
    if (!buffer) { this.soundIndex = []; this.soundIds.set([]); this.playbackError.set('The loaded JAR does not contain sounds.idx.'); return; }
    try {
      const entries = parseResourceFileIndex(buffer);
      for (const [id, entry] of entries.entries()) if (entry.fileId < 0 || entry.offset < 0 || entry.length <= 0) throw new RangeError(`Sound #${id} has an invalid index entry`);
      this.soundIndex = entries; this.soundIds.set(entries.map((_, id) => id)); this.playbackError.set(null);
    } catch (error) {
      this.soundIndex = []; this.soundIds.set([]); this.playbackError.set(`Could not read sounds.idx: ${this.message(error)}`);
    }
  }

  /** Returns an exact, independent slice; the virtual filesystem buffer is never modified. */
  getSoundArrayBuffer(id: number): ArrayBuffer | null {
    const entry = this.soundIndex[id]; if (!entry) return null;
    const source = this.fileService.getFile(`sounds${entry.fileId}.bin`);
    if (!source || entry.offset < 0 || entry.length <= 0 || entry.offset > source.byteLength - entry.length) return null;
    return source.slice(entry.offset, entry.offset + entry.length);
  }

  getSoundData(id: number): Blob | null {
    const data = this.getSoundArrayBuffer(id); if (!data) return null; const format = this.detectFormat(data);
    return new Blob([data], { type: format === 'wav' ? 'audio/wav' : format === 'au' ? 'audio/basic' : format === 'midi' ? 'audio/midi' : 'application/octet-stream' });
  }

  loadSound(id: number): boolean {
    this.stopSound(); this.clearSelection(); this.selectedSoundId.set(id); this.loading.set(true); this.playbackError.set(null);
    try {
      const data = this.getSoundArrayBuffer(id); if (!data) throw new Error(`Sound #${id} points outside its soundsNN.bin resource`);
      const format = this.detectFormat(data); this.format.set(format);
      if (format === 'midi') { const midi = parseMidi(data); this.midiInfo.set(midi); this.synth.load(midi); }
      else if (format !== 'wav' && format !== 'au') throw new Error(`Sound #${id} uses an unsupported or unrecognized format`);
      return true;
    } catch (error) { this.playbackError.set(this.message(error)); this.synth.clear(); return false; }
    finally { this.loading.set(false); }
  }

  async playSound(id: number): Promise<boolean> {
    if (this.selectedSoundId() !== id || !this.format()) if (!this.loadSound(id)) return false;
    this.playbackError.set(null); this.playingSoundId.set(id);
    if (this.format() === 'midi') { await (this.state() === 'paused' ? this.synth.resume() : this.synth.play()); if (this.synth.error()) { this.playbackError.set(this.synth.error()); this.playingSoundId.set(null); return false; } return true; }
    if (this.audio) { try { await this.audio.play(); return true; } catch (error) { this.playbackError.set(`Could not resume sound #${id}: ${this.message(error)}`); this.playingSoundId.set(null); return false; } }
    const blob = this.getSoundData(id)!; const url = URL.createObjectURL(blob); const audio = new Audio(url); this.audio = audio; this.objectUrl = url; audio.volume = this.volume();
    audio.ontimeupdate = () => { this.positionSeconds.set(audio.currentTime); this.durationSeconds.set(Number.isFinite(audio.duration) ? audio.duration : 0); };
    audio.onloadedmetadata = audio.ontimeupdate; audio.onended = () => this.releaseAudio(audio, url);
    audio.onerror = () => { this.playbackError.set(`The browser could not decode this ${this.format()?.toUpperCase()} resource.`); this.releaseAudio(audio, url); };
    try { await audio.play(); return true; } catch (error) { this.playbackError.set(`Could not play sound #${id}: ${this.message(error)}`); this.releaseAudio(audio, url); return false; }
  }

  pauseSound() { if (this.format() === 'midi') this.synth.pause(); else this.audio?.pause(); this.playingSoundId.set(null); }
  resumeSound() { const id = this.selectedSoundId(); if (id !== null) return this.playSound(id); return Promise.resolve(false); }
  seek(seconds: number) { if (this.format() === 'midi') this.synth.seek(seconds); else if (this.audio) this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 0)); }
  setVolume(value: number) { this.synth.setVolume(value); if (this.audio) this.audio.volume = this.volume(); }
  stopSound() { this.synth.stop(); if (this.audio) this.audio.pause(); this.releaseAudio(this.audio, this.objectUrl); this.playingSoundId.set(null); }

  private detectFormat(buffer: ArrayBuffer): SoundFormat { const bytes = new Uint8Array(buffer); if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'MThd') return 'midi'; if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') return 'wav'; if (bytes.length >= 4 && bytes[0] === 0x2e && bytes[1] === 0x73 && bytes[2] === 0x6e && bytes[3] === 0x64) return 'au'; return 'unknown'; }
  private clearSelection() { this.selectedSoundId.set(null); this.format.set(null); this.midiInfo.set(null); this.loading.set(false); this.synth.clear(); }
  private resetAll() { this.stopSound(); this.clearSelection(); this.soundIndex = []; this.soundIds.set([]); this.playbackError.set(null); }
  private releaseAudio(audio: HTMLAudioElement | null, url: string | null) { if (audio) { audio.onended = null; audio.onerror = null; audio.ontimeupdate = null; audio.removeAttribute('src'); audio.load(); } if (url) URL.revokeObjectURL(url); if (this.audio === audio) this.audio = null; if (this.objectUrl === url) this.objectUrl = null; }
  private message(error: unknown) { return error instanceof Error ? error.message : String(error); }
}
