import { Injectable } from '@angular/core';
import { BinaryWriter } from '../../../utils/byte-stream';
import { encodeInstruction, validateInstruction } from './script-instruction-codec';
import { SCRIPT_OPCODE_SCHEMA } from './script-opcode-schema';

export interface AssemblyResult { bytes: number[]; error?: string; }

@Injectable({ providedIn: 'root' })
export class ScriptAssemblerService {
  assemble(opcode: number, argsStr: string): AssemblyResult {
    const definition=SCRIPT_OPCODE_SCHEMA[opcode];
    if(!definition || definition.status!=='supported') return {bytes:[],error:`Unknown opcode: ${opcode}`};
    const tokens=argsStr.trim()?argsStr.trim().split(/\s+/):[];
    const params:number[]=[];
    for(const token of tokens) {
      const value=/^[-+]?0x/i.test(token)?Number.parseInt(token,16):Number(token);
      if(!Number.isInteger(value)) return {bytes:[],error:`Invalid numeric argument: ${token}`};
      params.push(value);
    }
    const errors=validateInstruction({opcode,params});
    if(errors.length) return {bytes:[],error:errors.join('; ')};
    try { const writer=new BinaryWriter(16,false); encodeInstruction(writer,{opcode,params},{}); return {bytes:Array.from(writer.getData())}; }
    catch(error) { return {bytes:[],error:error instanceof Error?error.message:String(error)}; }
  }
}
