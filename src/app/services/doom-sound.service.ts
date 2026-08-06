
import { Injectable, inject } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';

@Injectable({
  providedIn: 'root'
})
export class DoomSoundService {
  private fileService = inject(DoomFileService);
  private soundIndex = new Int32Array();

  async loadSoundsIndex() {
    const buffer = this.fileService.getFile('sounds.idx');
    if (!buffer) return;

    this.soundIndex = flattenResourceFileIndex(parseResourceFileIndex(buffer));
  }

  getSoundData(id: number): Blob | null {
      if (this.soundIndex.length === 0) this.loadSoundsIndex();
      
      const indexPosition = id * 3;
      if (id < 0 || indexPosition + 2 >= this.soundIndex.length) return null;
      
      const fileSuffix = this.soundIndex[indexPosition];
      const fileName = `sounds${fileSuffix}.bin`;
      const buffer = this.fileService.getFile(fileName);
      
      if (!buffer) return null;
      
      // Determine type. J2ME games usually use MIDI (.mid) or WAV/AU.
      // Check header.
      const view = new DataView(buffer);
      const head = view.getUint32(0, true); // Read as LE
      
      let mime = 'audio/wav';
      // MThd (MIDI) in Big Endian is 0x4D546864
      if (head === 0x6468544D) { // 'dPhM' (LE) -> MThd
          mime = 'audio/midi';
      } else if (head === 0x46464952) { // 'RIFF' (LE)
          mime = 'audio/wav';
      }
      
      return new Blob([buffer], { type: mime });
  }

  async playSound(id: number) {
      const blob = this.getSoundData(id);
      if (!blob) {
          console.warn(`Sound #${id} data not found.`);
          return;
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      audio.onended = () => {
          URL.revokeObjectURL(url);
      };
      
      try {
          await audio.play();
      } catch (e) {
          console.error("Audio playback failed", e);
          // MIDI playback in browser <audio> is poorly supported without plugins.
          if (blob.type === 'audio/midi') {
              alert("Browser cannot play raw MIDI files natively. Download the JAR to hear sounds in-game.");
          }
      }
  }
}
