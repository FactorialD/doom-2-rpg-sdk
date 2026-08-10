import { Injectable } from '@angular/core';
import { ScriptInstruction, ScriptFunctionTable, TileEventRef } from './script-types';
import { SCRIPT_OPCODE_SCHEMA } from './script-opcode-schema';
import { calculateInstructionSize, encodeInstruction } from './script-instruction-codec';
import { BinaryWriter } from '../../utils/byte-stream';

export interface CompilationResult {
    binary: Uint8Array;
    newStaticFuncs: number[];
    newTileEvents: Int32Array;
    errors: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ScriptCompilerService {
  static readonly SUPPORTED_TILE_EVENT_FLAGS = 0x7ffff;

  compile(
      instructions: ScriptInstruction[], 
      staticFuncRefs: ScriptFunctionTable,
      tileEventRefs: TileEventRef[],
      originalTileEvents: Int32Array
    ): CompilationResult {
        
        const errors: string[] = [];
        
        // --- Pass 1: Sizing & Offset Calculation ---
        let currentOffset = 0;
        const offsetMap = new Map<string, number>();

        for (const inst of instructions) {
            inst.offset = currentOffset;
            offsetMap.set(inst.uid, currentOffset);
            
            // Recalculate size based on current params
            inst.size = calculateInstructionSize(inst);
            currentOffset += inst.size;
        }

        // --- Pass 2: Code Generation using BinaryWriter ---
        const writer = new BinaryWriter(currentOffset);

        for (const inst of instructions) {
            const relocation = SCRIPT_OPCODE_SCHEMA[inst.opcode]?.relocations?.find(r =>
                r.reference === 'instruction-relative' || r.reference === 'instruction-absolute');
            if (relocation && inst.jumpTargetUid) {
                const targetOffset = offsetMap.get(inst.jumpTargetUid);
                const index = relocation.argumentIndex === 'last' ? inst.params.length - 1 : relocation.argumentIndex;
                if (targetOffset === undefined) {
                    if (inst.params[index] !== relocation.allowMissingValue) errors.push(`Broken Link: Instruction at ${inst.offset} points to missing target.`);
                } else {
                    const value = relocation.reference === 'instruction-relative' ? targetOffset - (inst.offset + inst.size) : targetOffset;
                    inst.params[index] = value;
                }
            }
            try { encodeInstruction(writer, inst, { offset: inst.offset }); }
            catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
        }

        // --- Pass 3: Update Table References ---
        
        // 1. Static Functions
        const newStaticFuncs: number[] = new Array(12).fill(65535);
        for (let i = 0; i < 12; i++) {
            const targetUid = staticFuncRefs[i];
            if (targetUid) {
                const off = offsetMap.get(targetUid);
                if (off !== undefined) {
                    newStaticFuncs[i] = off;
                }
            }
        }

        // 2. Tile Events
        const rebuiltEvents: number[] = [];
        const eventUids = new Set<string>();
        const eventKeys = new Set<string>();
        for (const ref of tileEventRefs) {
            if (!ref.uid || eventUids.has(ref.uid)) {
                errors.push(`Duplicate or missing tile event UID: ${ref.uid || '(empty)'}.`);
                continue;
            }
            eventUids.add(ref.uid);
            if (!Number.isInteger(ref.tileIndex) || ref.tileIndex < 0 || ref.tileIndex > 1023) {
                errors.push(`Invalid tile index ${ref.tileIndex}; expected 0-1023.`);
                continue;
            }
            if (!Number.isInteger(ref.flags) || ref.flags < 0 || (ref.flags & ~ScriptCompilerService.SUPPORTED_TILE_EVENT_FLAGS) !== 0) {
                errors.push(`Unsupported tile event flags 0x${(ref.flags >>> 0).toString(16)}.`);
                continue;
            }
            const key = `${ref.tileIndex}:${ref.targetUid}:${ref.flags}`;
            if (eventKeys.has(key)) {
                errors.push(`Duplicate tile event for tile ${ref.tileIndex}, target ${ref.targetUid}, and flags 0x${ref.flags.toString(16)}.`);
                continue;
            }
            eventKeys.add(key);
            const off = offsetMap.get(ref.targetUid);
            if (off === undefined) {
                errors.push(`Tile event ${ref.uid} points to missing target UID ${ref.targetUid || '(empty)'}.`);
            } else {
                if (off > 65535) errors.push(`Script too large! Offset ${off} exceeds limit.`);
                const packed = ((off & 0xFFFF) << 16) | (ref.tileIndex & 0xFFFF);
                rebuiltEvents.push(packed);
                rebuiltEvents.push(ref.flags);
            }
        }
        
        return {
            binary: writer.getData(),
            newStaticFuncs,
            newTileEvents: new Int32Array(rebuiltEvents),
            errors
        };
  }
  
}
