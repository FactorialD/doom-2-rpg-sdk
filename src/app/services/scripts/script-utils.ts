import { calculateInstructionSize } from './script-instruction-codec';
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
        return calculateInstructionSize({ opcode, params });
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
