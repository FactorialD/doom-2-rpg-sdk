
import { Injectable, inject } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../../utils/byte-stream';

@Injectable({
  providedIn: 'root'
})
export class DoomSoundService {
  private fileService = inject(DoomFileService);
  private soundIndex: number[] = []; // Maps Sound ID -> File Suffix

  async loadSoundsIndex() {
    const buffer = this.fileService.getFile('sounds.idx');
    if (!buffer) return;

    // Based on Resource.loadFileIndex
    // It reads count, then blocks of data. 
    // However, DoomFileService has a parseGenericIndex but sound.idx might be slightly different structure 
    // or standard. Let's use the standard parsing logic if possible, or manual.
    // Looking at Sound.java: sndIndex = Resource.loadFileIndex("/sounds.idx");
    // Resource.java loadFileIndex structure:
    // [Count: Short]
    // [Block of IDs (byte), Block of Offsets (int)]...
    
    // Actually, Resource.loadFileIndex returns an int[] where index[i*3] = fileSuffix (the ID from the file).
    // Let's manually parse it to be safe.
    
    const stream = new ByteStream(buffer);
    const count = stream.readShort();
    
    // The format in Resource.java (loadFileIndex) seems to support multiple chunks.
    // For simplicity, we'll try to parse it linearly.
    // Actually, DoomFileService.parseGenericIndex is designed for images.idx/strings.idx. 
    // Let's assume sounds.idx follows the same "ID, Offset" pattern.
    
    // However, Sound.java constructs filename as "sounds" + sndIndex[id * 3] + ".bin"
    // So we need that mapped value.
    
    const idxData = this.parseGenericIndex(buffer);
    // idxData is [fileId, offset, len, ...]
    
    this.soundIndex = [];
    for(let i=0; i<idxData.length; i+=3) {
        this.soundIndex.push(idxData[i]);
    }
  }

  getSoundData(id: number): Blob | null {
      if (this.soundIndex.length === 0) this.loadSoundsIndex();
      
      if (id < 0 || id >= this.soundIndex.length) return null;
      
      const fileSuffix = this.soundIndex[id];
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

  private parseGenericIndex(buffer: ArrayBuffer): Int32Array {
      const stream = new ByteStream(buffer);
      const count = stream.readShort();
      const result: number[] = [];
      
      let validCount = 0;
      while (validCount < count && stream.position < stream.length - 5) {
          const fileId = stream.readUByte();
          const offset = stream.readInt();
          result.push(fileId, offset, 0);
          validCount++;
      }
      return new Int32Array(result);
  }
}
