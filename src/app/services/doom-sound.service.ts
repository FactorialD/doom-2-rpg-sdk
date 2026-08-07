
import { Injectable, effect, inject, signal } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';

@Injectable({
  providedIn: 'root'
})
export class DoomSoundService {
  private fileService = inject(DoomFileService);
  private soundIndex: Int32Array<ArrayBuffer> = new Int32Array();
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  readonly soundIds = signal<readonly number[]>([]);
  readonly playingSoundId = signal<number | null>(null);
  readonly playbackError = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.fileService.isLoaded()) {
        this.loadSoundsIndex();
      } else {
        this.soundIndex = new Int32Array();
        this.soundIds.set([]);
        this.stopSound();
        this.playbackError.set(null);
      }
    });
  }

  loadSoundsIndex() {
    const buffer = this.fileService.getFile('sounds.idx');
    if (!buffer) {
      this.soundIndex = new Int32Array();
      this.soundIds.set([]);
      return;
    }

    this.soundIndex = flattenResourceFileIndex(parseResourceFileIndex(buffer));
    this.soundIds.set(Array.from({ length: this.soundIndex.length / 3 }, (_, id) => id));
  }

  getSoundData(id: number): Blob | null {
      const indexPosition = id * 3;
      if (id < 0 || indexPosition + 2 >= this.soundIndex.length) return null;
      
      const fileSuffix = this.soundIndex[indexPosition];
      const offset = this.soundIndex[indexPosition + 1];
      const length = this.soundIndex[indexPosition + 2];
      const fileName = `sounds${fileSuffix}.bin`;
      const buffer = this.fileService.getFile(fileName);
      
      if (!buffer || offset < 0 || length <= 0 || offset + length > buffer.byteLength) return null;

      const soundBuffer = buffer.slice(offset, offset + length);
      
      // Determine type. J2ME games usually use MIDI (.mid) or WAV/AU.
      // Check header.
      let mime = 'audio/wav';
      const view = new DataView(soundBuffer);
      if (view.byteLength < 4) return new Blob([soundBuffer], { type: mime });
      const head = view.getUint32(0, true); // Read as LE

      // MThd (MIDI) in Big Endian is 0x4D546864
      if (head === 0x6468544D) { // 'dPhM' (LE) -> MThd
          mime = 'audio/midi';
      } else if (head === 0x46464952) { // 'RIFF' (LE)
          mime = 'audio/wav';
      }
      
      return new Blob([soundBuffer], { type: mime });
  }

  async playSound(id: number): Promise<boolean> {
      this.stopSound();
      this.playbackError.set(null);
      const blob = this.getSoundData(id);
      if (!blob) {
          console.warn(`Sound #${id} data not found.`);
          this.playbackError.set(`Sound #${id} data was not found in the loaded JAR.`);
          return false;
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.objectUrl = url;
      this.audio = audio;
      this.playingSoundId.set(id);
      audio.onended = () => this.releaseAudio(audio, url);
      audio.onerror = () => {
          this.playbackError.set(`The browser could not play sound #${id}${blob.type === 'audio/midi' ? ' (raw MIDI is not widely supported)' : ''}.`);
          this.releaseAudio(audio, url);
      };
      
      try {
          await audio.play();
          return true;
      } catch (e) {
          console.error("Audio playback failed", e);
          this.playbackError.set(`The browser could not play sound #${id}${blob.type === 'audio/midi' ? ' (raw MIDI is not widely supported)' : ''}.`);
          this.releaseAudio(audio, url);
          return false;
      }
  }

  stopSound() {
    if (this.audio) this.audio.pause();
    this.releaseAudio(this.audio, this.objectUrl);
    this.playbackError.set(null);
  }

  private releaseAudio(audio: HTMLAudioElement | null, url: string | null) {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
    }
    if (url) URL.revokeObjectURL(url);
    if (this.audio === audio) this.audio = null;
    if (this.objectUrl === url) this.objectUrl = null;
    this.playingSoundId.set(null);
  }
}
