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
  static readonly SUPPORTED_TILE_EVENT_FLAGS = 0xfffff;

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
        const staged = new Map<string, { offset: number; size: number; params: number[] }>();

        for (const inst of instructions) {
            offsetMap.set(inst.uid, currentOffset);
            try {
                const params = [...inst.params];
                const size = calculateInstructionSize({ ...inst, params });
                staged.set(inst.uid, { offset: currentOffset, size, params });
                currentOffset += size;
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }

        // --- Pass 2: Code Generation using BinaryWriter ---
        const writer = new BinaryWriter(currentOffset);

        for (const inst of instructions) {
            const state = staged.get(inst.uid);
            if (!state) continue;
            const relocation = SCRIPT_OPCODE_SCHEMA[inst.opcode]?.relocations?.find(r =>
                r.reference === 'instruction-relative' || r.reference === 'instruction-absolute');
            if (relocation) {
                const targetOffset = inst.jumpTargetUid ? offsetMap.get(inst.jumpTargetUid) : undefined;
                const index = relocation.argumentIndex === 'last' ? state.params.length - 1 : relocation.argumentIndex;
                if (targetOffset === undefined) {
                    if (state.params[index] !== relocation.allowMissingValue) errors.push(`Broken Link: Instruction at ${state.offset} points to missing target.`);
                } else {
                    const value = relocation.reference === 'instruction-relative' ? targetOffset - (state.offset + state.size) : targetOffset;
                    state.params[index] = value;
                }
            }
            try { encodeInstruction(writer, { ...inst, params: state.params }, { offset: state.offset }); }
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
                } else errors.push(`Static function ${i} points to missing target UID ${targetUid}.`);
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
        
        if (errors.length === 0) {
            for (const inst of instructions) {
                const state = staged.get(inst.uid)!;
                inst.offset = state.offset;
                inst.size = state.size;
                inst.params = state.params;
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
