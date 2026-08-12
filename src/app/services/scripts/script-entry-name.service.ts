import { Injectable, signal } from '@angular/core';
import type { ScriptData } from '../doom-script.service';
import type { ScriptInstruction, TileEventRef } from './script-types';

/** SDK-only data. This object is deliberately not part of the map serializer. */
export interface ScriptEntryNameMetadata {
  readonly mapId: number;
  readonly instructionUid: string;
  readonly name: string;
}

export interface ScriptReferenceOption { value: number; label: string; uid?: string; }

const eventName = (event: TileEventRef): string => {
  const kind = (event.flags & 1) ? 'Enter' : (event.flags & 2) ? 'Exit' : (event.flags & 4) ? 'Use' : (event.flags & 8) ? 'Attack' : 'Event';
  return `${kind} (${event.tileIndex & 31}, ${event.tileIndex >> 5 & 31})`;
};

@Injectable({ providedIn: 'root' })
export class ScriptEntryNameService {
  private readonly names = new Map<string, ScriptEntryNameMetadata>();
  readonly revision = signal(0);

  private key(mapId: number, uid: string): string { return `${mapId}:${uid}`; }

  get(mapId: number, uid: string): string | undefined { return this.names.get(this.key(mapId, uid))?.name; }

  rename(mapId: number, instructionUid: string, value: string): void {
    const name = value.trim();
    const key = this.key(mapId, instructionUid);
    if (name) this.names.set(key, { mapId, instructionUid, name }); else this.names.delete(key);
    this.revision.update(value => value + 1);
  }

  /** Remove orphan labels, or atomically move them to a replacement instruction. */
  reconcile(data: ScriptData, replacements: ReadonlyMap<string, string> = new Map()): void {
    const live = new Set(data.instructions.map(instruction => instruction.uid));
    let changed = false;
    for (const metadata of [...this.names.values()].filter(item => item.mapId === data.mapId)) {
      if (live.has(metadata.instructionUid)) continue;
      this.names.delete(this.key(data.mapId, metadata.instructionUid));
      const replacement = replacements.get(metadata.instructionUid);
      if (replacement && live.has(replacement) && !this.get(data.mapId, replacement)) {
        this.names.set(this.key(data.mapId, replacement), { ...metadata, instructionUid: replacement });
      }
      changed = true;
    }
    if (changed) this.revision.update(value => value + 1);
  }

  labels(data: ScriptData, instruction: ScriptInstruction): string[] {
    this.revision();
    const result: string[] = [];
    const add = (label?: string) => { if (label && !result.includes(label)) result.push(label); };
    add(this.get(data.mapId, instruction.uid));
    for (const [index, uid] of Object.entries(data.staticFuncs)) if (uid === instruction.uid) add(`Func #${index}`);
    for (const event of data.tileEventRefs) if (event.targetUid === instruction.uid) add(eventName(event));
    if (instruction.offset === 0) add('Init');
    return result;
  }

  display(data: ScriptData, instruction: ScriptInstruction): string {
    const labels = this.labels(data, instruction);
    return [...labels, `0x${instruction.offset.toString(16).toUpperCase().padStart(4, '0')}`].join(' · ');
  }

  buildInstructionOptions(data: ScriptData, relativeTo?: number): ScriptReferenceOption[] {
    return data.instructions.map(instruction => ({
      uid: instruction.uid,
      value: relativeTo === undefined ? instruction.offset : instruction.offset - relativeTo,
      label: this.display(data, instruction)
    }));
  }
}
