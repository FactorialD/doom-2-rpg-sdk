
import { Injectable } from '@angular/core';
import { SCRIPT_OPCODES } from './script-opcodes';

export interface AssemblyResult {
    bytes: number[];
    error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ScriptAssemblerService {

  constructor() { }

  /**
   * Converts a human readable opcode + args string into raw bytes
   * Example: assemble(14, "50") -> [14, 50] (EV_WAIT)
   */
  assemble(opcode: number, argsStr: string): AssemblyResult {
    const def = SCRIPT_OPCODES[opcode];
    if (!def) {
        return { bytes: [], error: `Unknown opcode: ${opcode}` };
    }

    const bytes: number[] = [opcode];
    
    // Clean args string
    const inputArgs = argsStr.trim().split(/\s+/).filter(s => s.length > 0);
    
    // EV_EVAL (0) is complex
    if (opcode === 0) {
        try {
            const parts = inputArgs.map(s => {
                const val = parseInt(s, 10);
                if (isNaN(val)) throw new Error(`Invalid number: ${s}`);
                return val;
            });
            bytes.push(...parts);
            return { bytes };
        } catch (e: any) {
            return { bytes: [], error: "EVAL args must be raw byte numbers separated by spaces" };
        }
    }
    
    // EV_LERPSPRITE (4) is custom
    if (opcode === 4) {
         try {
            // User must provide raw bytes for now. 
            // e.g. "10 20 30" or "10 20 30 40 50"
            const parts = inputArgs.map(s => {
                const val = parseInt(s, 16); // Hex input likely for raw bytes
                if (isNaN(val)) {
                    // Try decimal
                    const valDec = parseInt(s, 10);
                    if (isNaN(valDec)) throw new Error(`Invalid byte: ${s}`);
                    return valDec;
                }
                return val;
            });
            bytes.push(...parts);
            return { bytes };
        } catch (e: any) {
             return { bytes: [], error: "LERPSPRITE requires raw bytes (space separated). " + e.message };
        }
    }

    // Handle standard formatted instructions
    const formatParts = def.format ? def.format.split(' ') : [];
    
    let argIdx = 0;

    try {
        for (const fmt of formatParts) {
            
            // Special Handlers for Complex Types
            if (fmt === 'var_loot_list') {
                if (argIdx >= inputArgs.length) return { bytes: [], error: 'Expected loot count' };
                const count = parseInt(inputArgs[argIdx++], 10);
                if (isNaN(count)) return { bytes: [], error: 'Invalid loot count' };
                
                bytes.push(count & 0xFF);
                
                for(let i = 0; i < count; i++) {
                    if (argIdx >= inputArgs.length) return { bytes: [], error: `Expected ${count} items, found ${i}` };
                    const item = parseInt(inputArgs[argIdx++], 10);
                    if (isNaN(item)) return { bytes: [], error: `Invalid item ID at index ${i}` };
                    bytes.push((item >> 8) & 0xFF, item & 0xFF);
                }
                continue;
            }
            
            if (fmt === 'drop_monster_item') {
                if (inputArgs.length - argIdx < 3) return { bytes: [], error: 'Expected 3 args: Loc Type Amount' };
                let loc = parseInt(inputArgs[argIdx++], 10);
                const type = parseInt(inputArgs[argIdx++], 10);
                const amount = parseInt(inputArgs[argIdx++], 10);
                
                if (isNaN(loc) || isNaN(type) || isNaN(amount)) return { bytes: [], error: 'Invalid numbers' };
                
                // Logic: If type > 255, set bit 15 of loc
                let isExtended = type > 255;
                if (isExtended) {
                    loc |= 0x8000;
                } else {
                    loc &= 0x7FFF;
                }
                
                bytes.push((loc >> 8) & 0xFF, loc & 0xFF);
                
                if (isExtended) {
                    bytes.push((type >> 8) & 0xFF); // High
                    bytes.push(type & 0xFF);        // Low
                } else {
                    bytes.push(type & 0xFF);
                }
                
                bytes.push(amount & 0xFF);
                continue;
            }
            
            if (fmt === 'custom_lerp') {
                // Handled above, but just in case
                continue;
            }

            if (argIdx >= inputArgs.length) {
                 return { bytes: [], error: `Expected ${formatParts.length} arguments, got ${argIdx}. Format: ${def.format}` };
            }

            const valStr = inputArgs[argIdx++];
            let val = parseInt(valStr, 10);
            
            if (isNaN(val)) {
                 return { bytes: [], error: `Argument ${argIdx} '${valStr}' is not a number` };
            }

            switch (fmt) {
                case 'u8':
                    if (val < 0 || val > 255) return { bytes: [], error: `Arg ${argIdx} (${val}) out of u8 range (0-255)` };
                    bytes.push(val);
                    break;
                case 's8':
                    if (val < -128 || val > 127) return { bytes: [], error: `Arg ${argIdx} (${val}) out of s8 range (-128-127)` };
                    // Convert to 2's complement byte
                    if (val < 0) val = 256 + val;
                    bytes.push(val);
                    break;
                case 'u16':
                    if (val < 0 || val > 65535) return { bytes: [], error: `Arg ${argIdx} (${val}) out of u16 range` };
                    // Big Endian
                    bytes.push((val >> 8) & 0xFF, val & 0xFF);
                    break;
                case 's16':
                    if (val < -32768 || val > 32767) return { bytes: [], error: `Arg ${argIdx} (${val}) out of s16 range` };
                    // Big Endian 2's complement
                    if (val < 0) val = 65536 + val;
                    bytes.push((val >> 8) & 0xFF, val & 0xFF);
                    break;
                case 's32':
                case 'u32': // Treat same for storage
                     // Big Endian
                     bytes.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
                     break;
                case 'debug_str':
                     // Special handling for DEBUGPRINT string: 0 "string"
                     bytes.push(val); 
                     break;
            }
        }
        
        // Handle variable length args that might follow (if user provided more than format specified)
        // This is risky but allows power users to hack "vararg" opcodes
        while (argIdx < inputArgs.length) {
            const val = parseInt(inputArgs[argIdx++], 10);
            if (!isNaN(val)) {
                if (val > 255) {
                     bytes.push((val >> 8) & 0xFF, val & 0xFF); // Guess u16
                } else {
                    bytes.push(val);
                }
            }
        }

    } catch (e: any) {
        return { bytes: [], error: e.message };
    }

    return { bytes };
  }
}
