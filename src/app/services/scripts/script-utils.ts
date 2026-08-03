import { SCRIPT_OPCODES } from './script-opcodes';
import { getVariableName } from '../doom-variables';

export class ScriptUtils {
    
    static generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Calculates the byte size of an instruction based on its Opcode and Params.
     * Crucial for the Compiler to determine offsets.
     */
    static calculateSize(opcode: number, params: any[]): number {
        let size = 1; // Opcode itself

        // Special handling for variable length or complex instructions
        if (opcode === 0) { // EV_EVAL
            return size + params.length;
        }
        
        if (opcode === 4) { // EV_LERPSPRITE (Custom Var Length)
            return size + params.length;
        }

        const def = SCRIPT_OPCODES[opcode];
        if (!def || !def.format) return size;

        const parts = def.format.split(' ');
        
        let paramIdx = 0;

        for (const part of parts) {
            if (part === 'var_loot_list') {
                const count = params[paramIdx++];
                size += 1; // Count byte
                size += count * 2; // Items are shorts
            } 
            else if (part === 'drop_monster_item') {
                const loc = params[paramIdx++];
                const type = params[paramIdx++];
                const amt = params[paramIdx++];
                
                size += 2; // Loc
                if (type > 255) size += 2;
                else size += 1;
                size += 1; // Amount
            }
            else if (part === 'debug_str') {
                const type = params[paramIdx++];
                size += 1;
                if (type === 0) {
                    const remaining = params.length - 1;
                    size += remaining;
                } else {
                    size += 1; // Var index
                }
            }
            else if (part === 'eval' || part === 'custom_lerp') {
                 size += params.length;
            }
            else {
                // Standard types
                switch (part) {
                    case 'u8': case 's8': size += 1; paramIdx++; break;
                    case 'u16': case 's16': size += 2; paramIdx++; break;
                    case 'u32': case 's32': size += 4; paramIdx++; break;
                }
            }
        }

        return size;
    }

    /**
     * Tries to convert RPN stack `[VAR, 5, >]` into `VAR > 5`
     */
    static formatRPN(tokens: string[]): string {
        const stack: string[] = [];
        
        for (const token of tokens) {
            if (['&&', '||', '<=', '<', '==', '!=', '>', '>='].includes(token)) {
                if (stack.length >= 2) {
                    const b = stack.pop();
                    const a = stack.pop();
                    stack.push(`(${a} ${token} ${b})`);
                } else {
                    stack.push(`ERR_OP(${token})`);
                }
            } else if (token === '!') {
                if (stack.length >= 1) {
                    const a = stack.pop();
                    stack.push(`!${a}`);
                }
            } else {
                stack.push(token);
            }
        }
        
        return stack.length === 1 ? `IF ${stack[0]}` : `IF ${tokens.join(' ')}`; 
    }
}