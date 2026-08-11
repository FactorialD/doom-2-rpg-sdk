import { Injectable, inject, signal, effect } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { DoomEntitiesService } from './doom-entities.service';
import { DoomTextService } from './doom-text.service';
import { DoomTextureService } from './doom-texture.service';
import { ByteStream, BinaryWriter, MAP_FIRST_MARKER, MAP_MARKER, checkedLength, readMarker } from '../utils/byte-stream';
import { ScriptDisassemblerService } from './scripts/script-disassembler.service';
import { ScriptCompilerService } from './scripts/script-compiler.service';
import { ScriptInstruction, ScriptFunctionTable, TileEventRef } from './scripts/script-types';
import { ScriptUtils } from './scripts/script-utils';

import { MapSprite } from './doom-map.service';
import { DoomSoundService } from './doom-sound.service';
import { SCRIPT_OPCODE_SCHEMA, ReferenceType, ScriptArgumentDescriptor } from './scripts/script-opcode-schema';

export type { ScriptInstruction, ScriptFunctionTable, TileEventRef };

export interface ScriptData {
  mapId: number;
  instructions: ScriptInstruction[];
  staticFuncs: ScriptFunctionTable;
  staticFuncOffsets: number[];
  rawSize: number;
  tileEvents: Int32Array;
  tileEventRefs: TileEventRef[];
  /** Populated when the map editor has decoded sprites; references still resolve safely without it. */
  mapSprites?: MapSprite[];
}

export interface ScriptReferencePreview {
  argumentIndex: number;
  name: string;
  reference: ReferenceType;
  rawValue: number;
  value: number;
  label: string;
  status: 'valid' | 'missing' | 'invalid';
  warning?: string;
  textureId?: number;
  entityType?: string;
  stringChunk?: number;
  targetOffset?: number;
}

export interface ItemReference {
    mapId: number;
    instruction: ScriptInstruction;
}

export interface EntityScriptReference { label: string; instruction: ScriptInstruction; relocatable: boolean; }

@Injectable({
  providedIn: 'root'
})
export class DoomScriptService {
  private fileService = inject(DoomFileService);
  private entityService = inject(DoomEntitiesService);
  private textService = inject(DoomTextService);
  private textureService = inject(DoomTextureService);
  private soundService = inject(DoomSoundService);
  private disassembler = inject(ScriptDisassemblerService);
  private compiler = inject(ScriptCompilerService);

  // Cache by Map ID
  private scriptCache = new Map<number, ScriptData>();

  constructor() {
      effect(() => {
          if (!this.fileService.isLoaded()) {
              this.scriptCache.clear();
          }
      });
  }

  /** Resolve every schema-declared semantic reference for one instruction. */
  resolveReferenceArguments(data: ScriptData, instruction: ScriptInstruction): ScriptReferencePreview[] {
      const definition = SCRIPT_OPCODE_SCHEMA[instruction.opcode];
      if (!definition) return [];
      const previews: ScriptReferencePreview[] = [];
      let paramIndex = 0;
      for (const descriptor of definition.arguments) {
          const start = paramIndex;
          const count = this.argumentParameterCount(descriptor, instruction.params, start);
          paramIndex += count;
          if (!descriptor.reference || count === 0) continue;
          let rawValue = Number(instruction.params[start]);
          if (descriptor.kind === 'lerpSprite') rawValue = (instruction.params[start] ?? 0) | ((instruction.params[start + 1] ?? 0) << 8) | ((instruction.params[start + 2] ?? 0) << 16);
          const value = descriptor.packedReference ? descriptor.packedReference.decode(rawValue) : rawValue;
          previews.push(this.resolveReference(data, instruction, descriptor, start, rawValue, value));
      }
      return previews;
  }

  private argumentParameterCount(descriptor: ScriptArgumentDescriptor, params: number[], index: number): number {
      if (descriptor.kind === 'eval' || descriptor.kind === 'lerpSprite' || descriptor.kind === 'debugString') return params.length - index;
      if (descriptor.kind === 'lootList') return 1 + (params[index] ?? 0);
      if (descriptor.kind === 'dropMonsterItem') return 3;
      return 1;
  }

  private resolveReference(data: ScriptData, instruction: ScriptInstruction, descriptor: ScriptArgumentDescriptor, argumentIndex: number, rawValue: number, value: number): ScriptReferencePreview {
      const base = { argumentIndex, name: descriptor.name, reference: descriptor.reference!, rawValue, value };
      const invalid = (warning: string): ScriptReferencePreview => ({ ...base, label: `#${value}`, status: 'invalid', warning });
      if (!Number.isInteger(value) || value < 0) return invalid(`Invalid ${descriptor.reference} reference: ${value}`);
      switch (descriptor.reference) {
          case 'string-index': {
              const chunk = data.mapId + 3;
              const text = this.textService.getStringValue(chunk, value);
              if (text.startsWith(`STR_${value}`)) return { ...base, label: `String #${value}`, status: 'missing', warning: `String #${value} is missing from chunk ${chunk}`, stringChunk: chunk };
              const excerpt = text.replace(/\s+/g, ' ').trim();
              return { ...base, label: `“${excerpt.slice(0, 72)}${excerpt.length > 72 ? '…' : ''}”`, status: 'valid', stringChunk: chunk };
          }
          case 'entity-index': {
              if (value === 255 || value === 4095 || value === 16383) return { ...base, label: 'Current entity', status: 'valid' };
              const sprite = data.mapSprites?.[value];
              if (!sprite) return { ...base, label: `Entity #${value}`, status: 'missing', warning: `Map sprite #${value} is unavailable` };
              const entity = this.entityService.getDefByTileIndex(sprite.textureId);
              const entityType = entity ? `type ${entity.eType}.${entity.eSubType}` : 'unknown type';
              return { ...base, label: `Sprite #${value} · ${entityType}`, status: entity ? 'valid' : 'missing', warning: entity ? undefined : `No entity definition for texture #${sprite.textureId}`, textureId: sprite.textureId, entityType };
          }
          case 'sound-index': {
              const blob = this.soundService.getSoundData(value);
              return blob ? { ...base, label: `Sound #${value} · ${blob.type === 'audio/midi' ? 'MIDI' : 'WAV'}`, status: 'valid' } : { ...base, label: `Sound #${value}`, status: 'missing', warning: `Sound #${value} is missing` };
          }
          case 'map-index': {
              const mapId = value + 1;
              const exists = !!this.fileService.getFile(`map0${mapId - 1}.bin`);
              return { ...base, value: mapId, label: `Map ${String(mapId).padStart(2, '0')} · spawn ${instruction.params[1] ?? '?'}`, status: exists ? 'valid' : 'missing', warning: exists ? undefined : `Map ${mapId} is missing` };
          }
          case 'tile-coordinate': {
              const tile = value & 0x3ff;
              return { ...base, value: tile, label: `Tile (${tile & 31}, ${tile >> 5 & 31})`, status: value <= 0xffff ? 'valid' : 'invalid', warning: value <= 0xffff ? undefined : 'Packed tile is outside the valid range' };
          }
          case 'tile-event-index': {
              const event = data.tileEventRefs[value];
              if (!event) return invalid(`Tile event #${value} does not exist`);
              return { ...base, label: `Tile event #${value} · (${event.tileIndex & 31}, ${event.tileIndex >> 5 & 31})`, status: 'valid' };
          }
          case 'instruction-relative':
          case 'instruction-absolute': {
              const targetOffset = descriptor.reference === 'instruction-relative' ? instruction.offset + instruction.size + value : value;
              const target = data.instructions.find(candidate => candidate.offset === targetOffset);
              if (!target) return { ...base, label: `0x${targetOffset.toString(16).toUpperCase()}`, status: 'invalid', warning: `No instruction starts at 0x${targetOffset.toString(16).toUpperCase()}`, targetOffset };
              const staticFunction = Object.entries(data.staticFuncs).find(([, uid]) => uid === target.uid)?.[0];
              return { ...base, label: staticFunction === undefined ? `${target.name} @ 0x${targetOffset.toString(16).toUpperCase()}` : `Static Func ${staticFunction} · ${target.name}`, status: 'valid', targetOffset };
          }
          case 'texture-index':
              return { ...base, label: `Texture #${value}`, status: 'valid', textureId: value };
      }
  }

  /**
   * Links script instructions to map sprites using UUIDs.
   * This ensures that if sprites are reordered, the scripts can be updated.
   */
  linkEntitiesToScripts(scriptData: ScriptData, sprites: MapSprite[]) {
      scriptData.mapSprites = sprites;
      for (const inst of scriptData.instructions) {
          if (inst.referencedEntityId !== undefined && inst.entityArgIndex !== undefined) {
              const targetSprite = sprites[inst.referencedEntityId];
              if (targetSprite) {
                  inst.referencedEntityUuid = targetSprite.uuid;
              } else {
                  console.warn(`Script references non-existent entity ID: ${inst.referencedEntityId}`);
              }
          }
      }
  }

  getEntityReferences(scriptData: ScriptData, uuid: string): EntityScriptReference[] {
      return scriptData.instructions
          .filter(instruction => instruction.referencedEntityUuid === uuid)
          .map(instruction => ({ instruction,
              relocatable: instruction.entityArgIndex !== undefined && !!SCRIPT_OPCODE_SCHEMA[instruction.opcode],
              label: `${instruction.name} at 0x${instruction.offset.toString(16).toUpperCase()}` }));
  }

  /**
   * Updates script instructions with new entity indices based on UUIDs.
   * Call this before saving scripts if sprites have been reordered or deleted.
   * Returns true if successful, false if there are broken references.
   */
  updateScriptIndices(scriptData: ScriptData, sprites: MapSprite[]): boolean {
      const indices = new Map(sprites.map((sprite, index) => [sprite.uuid, index]));
      for (const inst of scriptData.instructions) {
          if (inst.referencedEntityId !== undefined && inst.referencedEntityUuid === undefined) return false;
          if (inst.referencedEntityUuid === undefined) continue;
          const newIndex = indices.get(inst.referencedEntityUuid);
          if (newIndex === undefined || !this.entityOperandFits(inst, newIndex)) return false;
      }
      for (const inst of scriptData.instructions) {
          if (inst.referencedEntityUuid !== undefined && inst.entityArgIndex !== undefined) {
              const newIndex = sprites.findIndex(s => s.uuid === inst.referencedEntityUuid);

              if (newIndex !== -1) {
                  inst.referencedEntityId = newIndex;

                  // Update the actual parameter value
                  if (inst.opcode === 38) { // EV_NPCCHAT
                      // Special case: packed value
                      const val = inst.params[0];
                      const state = (val >> 14) & 3;
                      inst.params[0] = (state << 14) | (newIndex & 16383);
                  } else if (inst.opcode === 61) { // EV_LERPSCALE
                      // Special case: packed value in u16 (entId in bits 4-15, flags in bits 0-3)
                      let val = inst.params[0];
                      val &= 15; // keep flags
                      val |= (newIndex << 4);
                      inst.params[0] = val;
                  } else if (inst.opcode === 75 || inst.opcode === 95) { // EV_LERPSPRITEPARABOLA
                      // Special case: packed value in s32
                      let val = inst.params[0];
                      val &= ~(1023 << 22);
                      val |= (newIndex & 1023) << 22;
                      inst.params[0] = val;
                  } else if (inst.opcode === 83) { // EV_ASSIGN_LOOTSET (14-bit entity)
                      let val = inst.params[0];
                      val &= ~16383;
                      val |= newIndex & 16383;
                      inst.params[0] = val;
                  } else if (inst.opcode === 51) { // EV_AIGOAL (12-bit entity)
                      let val = inst.params[0];
                      val &= ~4095;
                      val |= newIndex & 4095;
                      inst.params[0] = val;
                  } else if (inst.opcode === 4) { // EV_LERPSPRITE
                      // Special case: packed value across b1, b2, b3
                      // combined = b1 | (b2 << 8) | (b3 << 16)
                      // entId is at combined >> 14 & 255
                      const b1 = inst.params[0];
                      const b2 = inst.params[1];
                      const b3 = inst.params[2];
                      let combined = b1 | (b2 << 8) | (b3 << 16);

                      // Clear bits 14-21
                      combined &= ~(255 << 14);
                      // Set new entId
                      combined |= (newIndex & 255) << 14;

                      inst.params[0] = combined & 255;
                      inst.params[1] = (combined >> 8) & 255;
                      inst.params[2] = (combined >> 16) & 255;
                  } else {
                      inst.params[inst.entityArgIndex] = newIndex;
                  }
              }
          }
      }
      scriptData.mapSprites = sprites;
      return true;
  }

  private entityOperandFits(instruction: ScriptInstruction, index: number): boolean {
      const argument = SCRIPT_OPCODE_SCHEMA[instruction.opcode]?.arguments.find(item => item.reference === 'entity-index');
      if (!argument) return false;
      if (argument.packedReference) return index >= argument.packedReference.min && index <= argument.packedReference.max;
      const max = argument.kind === 'u8' ? 0xff : argument.kind === 'u16be' ? 0xffff : 0x7fffffff;
      return Number.isInteger(index) && index >= 0 && index <= max;
  }

  async loadMapStrings(mapId: number) {
      // Lazy loading handled by text service usually
  }

  async saveScriptChanges(data: ScriptData): Promise<boolean> {
      console.log(`Compiling Map ${data.mapId}...`);

      const compileResult = this.compiler.compile(
          data.instructions,
          data.staticFuncs,
          data.tileEventRefs,
          data.tileEvents
      );

      if (compileResult.errors.length > 0) {
          alert("Compilation Errors:\n" + compileResult.errors.join("\n"));
          return false;
      }

      let currentOffset = 0;
      for (const inst of data.instructions) {
          inst.offset = currentOffset;
          currentOffset += inst.size;
      }

      data.rawSize = compileResult.binary.length;
      data.staticFuncOffsets = compileResult.newStaticFuncs;
      data.tileEvents = compileResult.newTileEvents;

      await this.writeBinaryToJar(data.mapId, compileResult.binary, compileResult.newStaticFuncs, compileResult.newTileEvents);

      return true;
  }

  async ensureScriptLoaded(mapId: number): Promise<ScriptData | null> {
      if (!this.scriptCache.has(mapId)) {
          return await this.loadAndDisassemble(mapId);
      }
      return this.scriptCache.get(mapId)!;
  }

  async appendScript(mapId: number, newBytes: number[]): Promise<ScriptInstruction | null> {
      const data = await this.ensureScriptLoaded(mapId);
      if (!data) return null;

      const newInsts = this.disassembler.disassemble(new Uint8Array(newBytes), mapId);

      if (newInsts.length === 0) return null;

      let startOffset = 0;
      if (data.instructions.length > 0) {
          const last = data.instructions[data.instructions.length - 1];
          startOffset = last.offset + last.size;
      }

      let currentOff = startOffset;
      for (const inst of newInsts) {
          inst.offset = currentOff;
          currentOff += inst.size;
          data.instructions.push(inst);
      }

      data.rawSize = currentOff;
      return newInsts[0];
  }

  async prependInstructionToInit(mapId: number, newBytes: number[]): Promise<boolean> {
      const data = await this.ensureScriptLoaded(mapId);
      if (!data) {
          console.error("prependInstructionToInit: Failed to load script data for map", mapId);
          return false;
      }

      // Find Init Function (Index 0)
      const initFuncUid = data.staticFuncs[0];
      let insertIndex = 0;

      if (initFuncUid) {
          const idx = data.instructions.findIndex(i => i.uid === initFuncUid);
          if (idx !== -1) insertIndex = idx;
      }

      let newInsts: ScriptInstruction[] = [];
      try {
          newInsts = this.disassembler.disassemble(new Uint8Array(newBytes), mapId);
      } catch (e) {
          console.error("prependInstructionToInit: Disassembly failed", e);
          return false;
      }

      if (newInsts.length === 0) {
          console.error("prependInstructionToInit: Disassembled instruction is empty");
          return false;
      }

      const newInst = newInsts[0];
      newInst.uid = ScriptUtils.generateUUID();

      console.log("Prepending Instruction:", newInst);

      // If Init didn't exist, we are creating it, so point Func 0 to this new instruction
      if (!initFuncUid) {
          data.staticFuncs[0] = newInst.uid;
      } else if (insertIndex === data.instructions.findIndex(i => i.uid === data.staticFuncs[0])) {
          // If we are inserting BEFORE the current start of Init, update the pointer
          data.staticFuncs[0] = newInst.uid;
      }

      data.instructions.splice(insertIndex, 0, newInst);

      // Recalc offsets
      let currentOffset = 0;
      for (const inst of data.instructions) {
          inst.offset = currentOffset;
          currentOffset += inst.size;
      }

      return true;
  }

  async addTileEvent(mapId: number, tileIndex: number, targetUid: string, flags: number): Promise<TileEventRef | null> {
      const data = await this.ensureScriptLoaded(mapId);
      if (!data || !this.isValidTileEvent(data, tileIndex, targetUid, flags)) return null;
      const ref = { uid: ScriptUtils.generateUUID(), tileIndex, targetUid, flags };
      data.tileEventRefs.push(ref);
      this.rebuildTileEvents(data);
      return ref;
  }

  async updateTileEvent(mapId: number, uid: string, changes: Pick<TileEventRef, 'flags' | 'targetUid'>): Promise<boolean> {
      const data = await this.ensureScriptLoaded(mapId);
      const ref = data?.tileEventRefs.find(event => event.uid === uid);
      if (!data || !ref || !this.isValidTileEvent(data, ref.tileIndex, changes.targetUid, changes.flags, uid)) return false;
      ref.flags = changes.flags;
      ref.targetUid = changes.targetUid;
      this.rebuildTileEvents(data);
      return true;
  }

  async duplicateTileEvent(mapId: number, uid: string): Promise<TileEventRef | null> {
      const data = await this.ensureScriptLoaded(mapId);
      const ref = data?.tileEventRefs.find(event => event.uid === uid);
      if (!data || !ref) return null;
      const candidateFlags = [0xff1, 0xff2, 0xff4, 0xff8]
          .find(flags => this.isValidTileEvent(data, ref.tileIndex, ref.targetUid, flags));
      if (candidateFlags === undefined) return null;
      const copy = { ...ref, uid: ScriptUtils.generateUUID(), flags: candidateFlags };
      data.tileEventRefs.push(copy);
      this.rebuildTileEvents(data);
      return copy;
  }

  async deleteTileEvent(mapId: number, uid: string): Promise<boolean> {
      const data = await this.ensureScriptLoaded(mapId);
      const index = data?.tileEventRefs.findIndex(event => event.uid === uid) ?? -1;
      if (!data || index < 0) return false;
      data.tileEventRefs.splice(index, 1);
      this.rebuildTileEvents(data);
      return true;
  }

  async createTileEventHandler(mapId: number, tileIndex: number, flags: number): Promise<TileEventRef | null> {
      const data = await this.ensureScriptLoaded(mapId);
      if (!data) return null;
      // EV_RETURN is a complete, side-effect-free handler and can safely be expanded later.
      const handler = this.disassembler.disassemble(new Uint8Array([2]), mapId)[0];
      handler.uid = ScriptUtils.generateUUID();
      handler.offset = data.rawSize;
      data.instructions.push(handler);
      this.recalculateOffsets(data);
      return this.addTileEvent(mapId, tileIndex, handler.uid, flags);
  }

  private rebuildTileEvents(data: ScriptData): void {
      const result = this.compiler.compile(data.instructions, data.staticFuncs, data.tileEventRefs, data.tileEvents);
      data.tileEvents = result.newTileEvents;
  }

  private isValidTileEvent(data: ScriptData, tileIndex: number, targetUid: string, flags: number, ignoredUid?: string): boolean {
      if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex > 1023 ||
          !Number.isInteger(flags) || flags < 0 || (flags & ~ScriptCompilerService.SUPPORTED_TILE_EVENT_FLAGS) !== 0 ||
          !data.instructions.some(inst => inst.uid === targetUid)) return false;
      return !data.tileEventRefs.some(ref => ref.uid !== ignoredUid && ref.tileIndex === tileIndex &&
          ref.targetUid === targetUid && ref.flags === flags);
  }

  private async writeBinaryToJar(mapId: number, bytecode: Uint8Array, staticFuncs: number[], tileEvents: Int32Array) {
      const mapFileName = `map0${mapId - 1}.bin`;
      const originalBuffer = this.fileService.getFile(mapFileName);
      if (!originalBuffer) return;

      const reader = new ByteStream(originalBuffer, true, mapFileName);
      const writer = new BinaryWriter(originalBuffer.byteLength + 1024);

      // 1. Read Header info for skipping
      reader.skip(11);
      const head_numNodes = reader.readUShort();
      const head_numLeaf = reader.readUShort();
      const head_numLines = reader.readUShort();
      const head_numNormals = reader.readUShort();
      const head_numPolys = reader.readUShort();
      const head_numVerts = reader.readUShort();
      const head_numNormalSprites = reader.readUShort();
      const head_numZSprites = reader.readShort();

      reader.position = 0;

      // --- COPY EVERYTHING UP TO SCRIPTS ---
      // We process skipping to know how many bytes to copy, or just copy in chunks.
      // Easier to just use the reader to skip, calculate offset, and copy block.

      const startPos = 0;

      // Header
      reader.skip(46);

      // Media
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
      const mediaCount = reader.readUShort();
      reader.skip(mediaCount * 2);

      // Geometry
      readMarker(reader, MAP_FIRST_MARKER, 'normals'); reader.skip(head_numNormals * 3 * 2);
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes * 2);
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes);
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes * 2); reader.skip(head_numNodes * 2);
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes * 2); reader.skip(head_numNodes * 2);
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numLeaf * 2); reader.skip(head_numLeaf * 2);

      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
      reader.skip(head_numPolys * 2);
      reader.skip(head_numVerts * 5);

      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
      reader.skip(Math.floor((head_numLines + 1) / 2));
      reader.skip(head_numLines * 2);
      reader.skip(head_numLines * 2);

      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(1024); // Heightmap

      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
      const totalSprites = head_numNormalSprites + head_numZSprites;
      reader.skip(totalSprites * 3);
      readMarker(reader, MAP_MARKER, 'sprite flags'); reader.skip(totalSprites * 2);
      readMarker(reader, MAP_MARKER, 'sprite z coordinates'); reader.skip(head_numZSprites);
      readMarker(reader, MAP_MARKER, 'sprite extra data'); reader.skip(head_numZSprites);

      const scriptStartPos = reader.position;

      // Copy Pre-Script Data
      writer.writeBytes(new Uint8Array(originalBuffer.slice(0, scriptStartPos)));

      // Update Header Counts in the new buffer (Writer) directly
      // numTileEvents is at 27, ByteCodeSize at 29
      // Access writer's internal view/buffer isn't clean via API, but we can do it via a second DataView on result,
      // OR we can just write it now if we knew where it was.
      // Easier: Generate full file, then patch header.

      // --- WRITE NEW SCRIPTS ---

      // 1. Static Funcs
      writer.writeInt(-889275714); // Marker
      for(let i=0; i<12; i++) writer.writeUShort(staticFuncs[i]);

      // 2. Tile Events
      writer.writeInt(-889275714); // Marker
      const numEvents = tileEvents.length / 2;
      for(let i=0; i<numEvents; i++) {
          writer.writeInt(tileEvents[i*2]);     // Packed
          writer.writeInt(tileEvents[i*2+1]);   // Flags
      }

      // 3. Bytecode
      writer.writeInt(-889275714); // Marker
      writer.writeBytes(bytecode);

      // --- SKIP OLD SCRIPTS IN READER ---
      const oldHeaderView = new DataView(originalBuffer);
      const oldNumTileEvents = oldHeaderView.getInt16(27, true);
      const oldByteCodeSize = oldHeaderView.getInt16(29, true);

      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(12 * 2); // Static Funcs
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(oldNumTileEvents * 8); // Tile Events
      readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(oldByteCodeSize); // Bytecode

      // --- COPY REMAINDER (Cameras, etc) ---
      const endOfScripts = reader.position;
      const remainder = originalBuffer.slice(endOfScripts);
      writer.writeBytes(new Uint8Array(remainder));

      // --- PATCH HEADER ---
      const finalBuffer = writer.getData();
      const patchView = new DataView(finalBuffer.buffer);
      patchView.setInt16(27, numEvents, true);
      patchView.setInt16(29, bytecode.length, true);

      this.fileService.saveBuffer(mapFileName, finalBuffer.buffer);
      console.log("Script Saved. New Bytecode Size:", bytecode.length);
  }

  async loadAndDisassemble(mapId: number, forceReload: boolean = false): Promise<ScriptData | null> {
    if (!forceReload && this.scriptCache.has(mapId)) {
        return this.scriptCache.get(mapId)!;
    }

    await this.loadMapStrings(mapId);
    const mapFileName = `map0${mapId - 1}.bin`;
    const buffer = this.fileService.getFile(mapFileName);
    if (!buffer) return null;

    const reader = new ByteStream(buffer, true, mapFileName);
    reader.ensureAvailable(46, 'header');

    // --- HEADER ---
    const headerView = new DataView(buffer);
    const head_numNodes = headerView.getUint16(11, true);
    const head_numLeaf = headerView.getUint16(13, true);
    const head_numLines = headerView.getUint16(15, true);
    const head_numNormals = headerView.getUint16(17, true);
    const head_numPolys = headerView.getUint16(19, true);
    const head_numVerts = headerView.getUint16(21, true);
    const head_numNormalSprites = headerView.getUint16(23, true);
    const head_numZSprites = headerView.getInt16(25, true);

    const numTileEvents = headerView.getInt16(27, true);
    const codeSize = headerView.getInt16(29, true);
    checkedLength(head_numZSprites, 1, mapFileName, 'header z-sprite count', 25);
    checkedLength(numTileEvents, 8, mapFileName, 'header tile-event count', 27);
    checkedLength(codeSize, 1, mapFileName, 'header bytecode size', 29);

    // Skip all sections to get to scripts
    reader.skip(46);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); const mediaCount = reader.readUShort(); reader.skip(mediaCount * 2);
    readMarker(reader, MAP_FIRST_MARKER, 'normals'); reader.skip(head_numNormals * 3 * 2);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes * 2);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes * 2); reader.skip(head_numNodes * 2);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numNodes * 2); reader.skip(head_numNodes * 2);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numLeaf * 2); reader.skip(head_numLeaf * 2);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(head_numPolys * 2); reader.skip(head_numVerts * 5);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(Math.floor((head_numLines + 1) / 2)); reader.skip(head_numLines * 2); reader.skip(head_numLines * 2);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section'); reader.skip(1024);
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
    const totalSprites = head_numNormalSprites + head_numZSprites;
    reader.skip(totalSprites * 3);
    readMarker(reader, MAP_MARKER, 'sprite flags'); reader.skip(totalSprites * 2);
    readMarker(reader, MAP_MARKER, 'sprite z coordinates'); reader.skip(head_numZSprites);
    readMarker(reader, MAP_MARKER, 'sprite extra data'); reader.skip(head_numZSprites);

    // --- STATIC FUNCS ---
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
    const staticFuncsOffsets: number[] = [];
    for(let i=0; i<12; i++) staticFuncsOffsets.push(reader.readUShort());

    // --- TILE EVENTS ---
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
    const tileEvents = new Int32Array(numTileEvents * 2);
    const tileEventRefs: TileEventRef[] = [];

    for(let i=0; i<numTileEvents; i++) {
        const packed = reader.readInt();
        const flags = reader.readInt();
        tileEvents[i*2] = packed;
        tileEvents[i*2+1] = flags;

        const tileIndex = packed & 0xFFFF;
        const offset = (packed >>> 16) & 0xFFFF;

        tileEventRefs.push({
            uid: ScriptUtils.generateUUID(),
            tileIndex,
            targetUid: '',
            flags
        });
        (tileEventRefs[i] as any)._tempOffset = offset;
    }

    // --- BYTECODE ---
    readMarker(reader, reader.position === 46 ? MAP_FIRST_MARKER : MAP_MARKER, 'map section');
    const bytecode = reader.readByteArray(codeSize);

    // --- DISASSEMBLY ---
    const instructions = this.disassembler.disassemble(bytecode, mapId);

    // --- LINKING ---
    const offsetToUid = new Map<number, string>();
    instructions.forEach(inst => offsetToUid.set(inst.offset, inst.uid));

    const staticFuncTable: ScriptFunctionTable = {};
    staticFuncsOffsets.forEach((off, idx) => {
        if (off !== 65535) {
            const uid = offsetToUid.get(off);
            if (uid) {
                staticFuncTable[idx] = uid;
                if (idx === 7) {
                    console.log(`[MAP ${mapId}] staticFuncs[7] found at offset ${off}. Instructions:`);
                    const targetInst = instructions.find(i => i.uid === uid);
                    if (targetInst) {
                        let currIdx = instructions.indexOf(targetInst);
                        while(currIdx < instructions.length) {
                            const inst = instructions[currIdx];
                            console.log(`  ${inst.offset}: ${inst.name} ${inst.params.join(',')}`);
                            if (inst.opcode === 0 || inst.opcode === 1) break; // EV_END or EV_RETURN
                            currIdx++;
                        }
                    }
                }
            }
        }
    });

    tileEventRefs.forEach(ref => {
        const off = (ref as any)._tempOffset;
        const uid = offsetToUid.get(off);
        if (uid) ref.targetUid = uid;
        delete (ref as any)._tempOffset;
    });

    instructions.forEach(inst => {
        if (inst.isJump && inst.jumpTarget !== undefined) {
             inst.jumpTargetUid = offsetToUid.get(inst.jumpTarget);
        }
    });

    const result: ScriptData = {
        mapId,
        instructions,
        staticFuncs: staticFuncTable,
        staticFuncOffsets: staticFuncsOffsets,
        rawSize: codeSize,
        tileEvents,
        tileEventRefs
    };

    this.scriptCache.set(mapId, result);
    return result;
  }

  // --- Search Methods (Preserved) ---
  async findReferencesToItem(type: number, id: number): Promise<ItemReference[]> {
      const results: ItemReference[] = [];
      for (let i=1; i<=9; i++) {
          try {
              let data = this.scriptCache.get(i);
              if (!data) data = await this.loadAndDisassemble(i);
              if (!data) continue;
              for (const inst of data.instructions) {
                  if (inst.opcode === 33 && inst.params[0] === type && inst.params[1] === id) {
                      results.push({ mapId: i, instruction: inst });
                  } else if (inst.opcode === 8 && inst.params[0] === id && inst.params[1] === type) {
                      results.push({ mapId: i, instruction: inst });
                  }
              }
          } catch(e) {}
      }
      return results;
  }

  async findReferencesToVariable(varId: number): Promise<ItemReference[]> {
      const results: ItemReference[] = [];
      for (let i=1; i<=9; i++) {
          try {
              let data = this.scriptCache.get(i);
              if (!data) data = await this.loadAndDisassemble(i);
              if (!data) continue;
              for (const inst of data.instructions) {
                  if ((inst.opcode === 6 || inst.opcode === 26 || inst.opcode === 27) && inst.params[0] === varId) {
                      results.push({ mapId: i, instruction: inst });
                  }
              }
          } catch(e) {}
      }
      return results;
  }

  getReferencedEntityIds(mapId: number): Promise<Set<number>> {
      const loader = this.scriptCache.has(mapId) ? Promise.resolve(this.scriptCache.get(mapId)) : this.loadAndDisassemble(mapId);
      return loader.then(data => {
          const ids = new Set<number>();
          if (!data) return ids;
          for (const inst of data.instructions) {
              if (inst.referencedEntityId !== undefined) ids.add(inst.referencedEntityId);
          }
          return ids;
      });
  }

  // --- CRUD Operations ---
  updateInstruction(data: ScriptData, inst: ScriptInstruction, newBytes: number[]) {
      const tempInst = this.disassembler.disassemble(new Uint8Array(newBytes), data.mapId)[0];
      inst.opcode = tempInst.opcode;
      inst.name = tempInst.name;
      inst.params = tempInst.params;
      inst.formattedArgs = tempInst.formattedArgs;
      inst.isJump = tempInst.isJump;
      inst.readableName = tempInst.readableName;
      inst.readableDetails = tempInst.readableDetails;
      inst.refType = tempInst.refType;
      inst.refId = tempInst.refId;
      inst.referencedEntityId = tempInst.referencedEntityId;
      inst.size = newBytes.length;
      inst.originalBytes = newBytes;
      this.recalculateOffsets(data);
  }

  insertInstruction(data: ScriptData, referenceOffset: number, newBytes: number[], position: 'before' | 'after' = 'after') {
      const idx = data.instructions.findIndex(i => i.offset === referenceOffset);
      if (idx === -1) return;

      const newInst = this.disassembler.disassemble(new Uint8Array(newBytes), data.mapId)[0];
      newInst.uid = ScriptUtils.generateUUID();

      const insertIdx = position === 'after' ? idx + 1 : idx;

      if (position === 'before') {
          // If inserting BEFORE an instruction, we must check if any Labels point to the original instruction.
          // If so, the label should usually point to the NEW instruction (effectively moving the old one down).
          // But wait, the user's request is "Do NOT move the function start".
          // If I insert BEFORE the first instruction, I am pushing the first instruction down.
          // If the Function points to the first instruction, the Function pointer should technically point to the NEW instruction to maintain "Index 0".
          // BUT if the user means "I want to move code line, but leave the header where it is", that usually applies to Drag & Drop (moveInstruction).
          // For explicit INSERT, if I insert before the header, I usually want to expand the function.

          // Let's implement standard insert logic: Labels point to UIDs. UIDs don't change.
          // If Func 0 -> UID_A. I insert B before A. Func 0 still points to UID_A.
          // Result: [B, A (Func 0 start)].
          // This seems correct for "Insert Before".

          // If the user wants to extend the function, they usually drag code or use "Insert After" on previous block.
          // However, if this is the very first instruction, there is no "previous".

          // Let's keep insert logic simple for now and focus on fixing Drag & Drop in moveInstruction.
      }

      data.instructions.splice(insertIdx, 0, newInst);
      this.recalculateOffsets(data);
  }

  deleteInstruction(data: ScriptData, inst: ScriptInstruction) {
      const idx = data.instructions.indexOf(inst);
      if (idx !== -1) {
          for (const [key, uid] of Object.entries(data.staticFuncs)) {
              if (uid === inst.uid) {
                  const funcIdx = parseInt(key, 10);
                  if (idx + 1 < data.instructions.length) {
                      data.staticFuncs[funcIdx] = data.instructions[idx + 1].uid;
                  } else {
                      delete data.staticFuncs[funcIdx];
                  }
              }
          }

          for (const ref of data.tileEventRefs) {
              if (ref.targetUid === inst.uid) {
                  if (idx + 1 < data.instructions.length) {
                      ref.targetUid = data.instructions[idx + 1].uid;
                  }
              }
          }

          data.instructions.splice(idx, 1);
          this.recalculateOffsets(data);
      }
  }

  // --- Reordering Logic ---
  moveInstruction(data: ScriptData, uid: string, targetUid: string, position: 'before' | 'after') {
      const fromIdx = data.instructions.findIndex(i => i.uid === uid);
      const toIdxOriginal = data.instructions.findIndex(i => i.uid === targetUid);

      if (fromIdx === -1 || toIdxOriginal === -1 || fromIdx === toIdxOriginal) return;

      // 1. Check if the instruction we are moving is a TARGET for a label (Function/Event)
      // If it is, we likely want the label to STAY at the current position (index), not follow the code.
      const funcsPointingHere = Object.entries(data.staticFuncs)
          .filter(([_, funcUid]) => funcUid === uid)
          .map(([k]) => parseInt(k));

      const eventsPointingHere = data.tileEventRefs.filter(ref => ref.targetUid === uid);
      const isReferenceTarget = funcsPointingHere.length > 0 || eventsPointingHere.length > 0;

      // 2. Perform the Move
      const [item] = data.instructions.splice(fromIdx, 1);

      // Calculate new index after splice
      let newToIdx = data.instructions.findIndex(i => i.uid === targetUid);
      if (position === 'after') newToIdx++;

      data.instructions.splice(newToIdx, 0, item);

      // 3. Fix Pointers if needed
      // If we moved the "Header" instruction (the one pointed to), we want to detach the label
      // and attach it to whatever instruction filled the gap.
      if (isReferenceTarget) {
          // The item that WAS at `fromIdx` is gone.
          // The item that TOOK ITS PLACE is now at `fromIdx`.
          // Unless `fromIdx` was the last item, there is a new item there.

          // Note on indices:
          // If we moved item DOWN (from 0 to 5):
          // Splice removed 0. Old 1 is now 0.
          // We want label to point to new 0.

          // If we moved item UP (from 5 to 0):
          // Splice removed 5. Old 6 is now 5.
          // But we moved it TO 0.
          // The label was at 5. We want it to stay at 5?
          // No, usually "Labels" are logically attached to the "Top of the block".
          // If I move the header line *away*, I want the label to stay at the top of that visual block.
          // Visual Block == "Code starting at index X".

          // So: The logic is simply "The label should point to whatever is now at fromIdx".

          let replacementIdx = fromIdx;
          // If we moved the last item, we point to the new last item (index - 1) or keep it if empty?
          if (replacementIdx >= data.instructions.length) {
              replacementIdx = data.instructions.length - 1;
          }

          if (replacementIdx >= 0) {
              const newTargetUid = data.instructions[replacementIdx].uid;

              // Only update if we actually found a replacement (not empty script)
              // Update Funcs
              for (const funcIdx of funcsPointingHere) {
                  data.staticFuncs[funcIdx] = newTargetUid;
              }
              // Update Events
              for (const evt of eventsPointingHere) {
                  evt.targetUid = newTargetUid;
              }
          }
      }

      this.recalculateOffsets(data);
  }

  private recalculateOffsets(data: ScriptData) {
      let offset = 0;
      for (const inst of data.instructions) {
          inst.offset = offset;
          offset += inst.size;
      }
      data.rawSize = offset;
  }

}
