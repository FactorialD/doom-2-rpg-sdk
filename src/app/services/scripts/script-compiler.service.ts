import { Injectable } from '@angular/core';
import { ScriptInstruction, ScriptFunctionTable, TileEventRef } from './script-types';
import { ScriptUtils } from './script-utils';
import { SCRIPT_OPCODES } from './script-opcodes';
import { BinaryWriter } from '../../../utils/byte-stream';

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
            inst.size = ScriptUtils.calculateSize(inst.opcode, inst.params);
            currentOffset += inst.size;
        }

        // --- Pass 2: Code Generation using BinaryWriter ---
        const writer = new BinaryWriter(currentOffset);

        for (const inst of instructions) {
            
            // Write Opcode
            writer.writeUByte(inst.opcode);

            // Handle Jumps logic
            if (inst.isJump && inst.jumpTargetUid) {
                const targetOffset = offsetMap.get(inst.jumpTargetUid);
                
                if (targetOffset === undefined) {
                    if (inst.opcode === 36 && inst.params[1] === -1) {
                         // Valid cleanup
                    } else {
                        errors.push(`Broken Link: Instruction at ${inst.offset} points to missing target.`);
                    }
                    this.writeParams(writer, inst);
                } else {
                    const instEnd = inst.offset + inst.size;
                    
                    if (inst.opcode === 0) { // EV_EVAL
                        const rel = targetOffset - instEnd;
                        if (rel < 0) errors.push(`EV_EVAL at ${inst.offset}: Backward jumps not supported.`);
                        else if (rel > 255) errors.push(`EV_EVAL at ${inst.offset}: Jump target too far.`);
                        
                        inst.params[inst.params.length - 1] = rel;
                        this.writeParams(writer, inst);
                        
                    } else if (inst.opcode === 1) { // EV_JUMP
                        const rel = targetOffset - instEnd;
                        if (rel < 0) errors.push(`EV_JUMP at ${inst.offset}: Backward jumps unsafe.`);
                        inst.params[0] = rel;
                        this.writeParams(writer, inst);
                    } 
                    else if (inst.opcode === 7) { // EV_CALL_FUNC
                        inst.params[0] = targetOffset;
                        this.writeParams(writer, inst);
                    }
                    else if (inst.opcode === 36) { // EV_SETDEATHFUNC
                        inst.params[1] = targetOffset;
                        this.writeParams(writer, inst);
                    }
                    else {
                        this.writeParams(writer, inst);
                    }
                }
            } else {
                this.writeParams(writer, inst);
            }
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
        for (const ref of tileEventRefs) {
            const off = offsetMap.get(ref.targetUid);
            if (off !== undefined) {
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
  
  private writeParams(writer: BinaryWriter, inst: ScriptInstruction) {
      if (inst.opcode === 0) { // EV_EVAL
          for (const p of inst.params) writer.writeUByte(p);
          return;
      }
      
      if (inst.opcode === 41) { // EV_GIVELOOT
          const count = inst.params[0];
          writer.writeUByte(count);
          for(let i=1; i < inst.params.length; i++) {
              // Big Endian override for this specific opcode param in older format, 
              // but typically we stick to Little Endian for J2ME unless specified.
              // Wait, previous code used setUint16(pos, val, false) -> Big Endian.
              // So we need to handle endianness.
              // BinaryWriter defaults to LE. We can implement BE write here manually.
              const val = inst.params[i];
              writer.writeUByte((val >> 8) & 0xFF);
              writer.writeUByte(val & 0xFF);
          }
          return;
      }

      const opDef = SCRIPT_OPCODES[inst.opcode];
      if (!opDef || !opDef.format) {
          if(inst.params) {
             for (const p of inst.params) writer.writeUByte(p);
          }
          return;
      }
      
      if (opDef.format === 'custom_lerp' || opDef.format === 'eval') {
          for (const p of inst.params) writer.writeUByte(p);
          return;
      }

      const parts = opDef.format.split(' ');
      let paramIdx = 0;

      for (const part of parts) {
          if (part === '') continue;

          if (part === 'var_loot_list') {
              const count = inst.params[paramIdx++];
              writer.writeUByte(count);
              for(let k=0; k<count; k++) {
                  const val = inst.params[paramIdx++];
                  // Big Endian for loot list items
                  writer.writeUByte((val >> 8) & 0xFF).writeUByte(val & 0xFF);
              }
          }
          else if (part === 'drop_monster_item') {
              const loc = inst.params[paramIdx++];
              const type = inst.params[paramIdx++];
              const amt = inst.params[paramIdx++];
              
              let writeLoc = loc;
              if (type > 255) writeLoc |= 0x8000;
              else writeLoc &= 0x7FFF;
              
              // Big Endian
              writer.writeUByte((writeLoc >> 8) & 0xFF).writeUByte(writeLoc & 0xFF);
              
              if (type > 255) {
                  writer.writeUByte((type >> 8) & 0xFF).writeUByte(type & 0xFF);
              } else {
                  writer.writeUByte(type);
              }
              writer.writeUByte(amt);
          }
          else if (part === 'u16' || part === 's16') {
               const val = inst.params[paramIdx++];
               // Big Endian for script args
               writer.writeUByte((val >> 8) & 0xFF).writeUByte(val & 0xFF);
          }
          else if (part === 'u32' || part === 's32') {
               const val = inst.params[paramIdx++];
               // Big Endian
               writer.writeUByte((val >> 24) & 0xFF)
                     .writeUByte((val >> 16) & 0xFF)
                     .writeUByte((val >> 8) & 0xFF)
                     .writeUByte(val & 0xFF);
          }
          else if (part === 'debug_str') {
              const type = inst.params[paramIdx++];
              writer.writeUByte(type);
              if (type === 0) {
                   while(paramIdx < inst.params.length) {
                       writer.writeUByte(inst.params[paramIdx++]);
                   }
              } else {
                  writer.writeUByte(inst.params[paramIdx++]);
              }
          }
          else {
               // u8, s8
               writer.writeUByte(inst.params[paramIdx++]);
          }
      }
      
      // Variable args remainder
      while(paramIdx < inst.params.length) {
          writer.writeUByte(inst.params[paramIdx++]);
      }
  }
}
