import { BinaryWriter, ByteStream } from '../../utils/byte-stream';
import { SCRIPT_OPCODE_SCHEMA, ArgumentKind, ScriptArgumentDescriptor } from './script-opcode-schema';
import { ScriptInstruction } from './script-types';

export interface ScriptCodecContext { offset?: number; }
export type DecodedInstruction = Pick<ScriptInstruction, 'opcode' | 'params' | 'size'>;

const bounds: Partial<Record<ArgumentKind, [number, number]>> = {
  u8: [0,255], s8: [-128,127], u16be: [0,65535], s16be: [-32768,32767],
  u32be: [0,0xffffffff], s32be: [-0x80000000,0x7fffffff]
};
function fail(context: ScriptCodecContext, message: string): never {
  throw new Error(`Script bytecode at offset ${context.offset ?? 0}: ${message}`);
}
function readPrimitive(stream: ByteStream, kind: ArgumentKind): number {
  switch (kind) {
    case 'u8': return stream.readUByte(); case 's8': return stream.readByte();
    case 'u16be': return stream.readUShort(); case 's16be': return stream.readShort();
    case 'u32be': return stream.readInt() >>> 0; case 's32be': return stream.readInt();
    default: throw new Error(`Not a primitive codec: ${kind}`);
  }
}
function decodeArgument(stream: ByteStream, descriptor: ScriptArgumentDescriptor): number[] {
  if (bounds[descriptor.kind]) return [readPrimitive(stream, descriptor.kind)];
  if (descriptor.kind === 'eval') {
    const count = stream.readUByte(), result = [count];
    for (let i=0; i<count; i++) { const token=stream.readUByte(); result.push(token); if ((token&0xc0)===0x40) result.push(stream.readUByte()); }
    result.push(stream.readUByte()); return result;
  }
  if (descriptor.kind === 'lerpSprite') {
    const result=[stream.readUByte(),stream.readUByte(),stream.readUByte()]; const packed=result[0]|result[1]<<8|result[2]<<16;
    if ((packed&8)===0) result.push(stream.readUByte()); if ((packed&4)===0) result.push(stream.readUByte()); return result;
  }
  if (descriptor.kind === 'lootList') { const count=stream.readUByte(), result=[count]; for(let i=0;i<count;i++) result.push(stream.readUShort()); return result; }
  if (descriptor.kind === 'dropMonsterItem') {
    const raw=stream.readUShort(), extended=!!(raw&0x8000); let type=stream.readUByte();
    if (extended) type=(type<<8)|stream.readUByte(); return [raw&0x7fff,type,stream.readUByte()];
  }
  const type=stream.readUByte(), result=[type];
  if (type===0) { let value: number; do { value=stream.readUByte(); result.push(value); } while(value!==0); } else result.push(stream.readUByte());
  return result;
}

export function decodeInstruction(stream: ByteStream, context: ScriptCodecContext = {}): DecodedInstruction {
  const start=stream.position;
  try {
    const opcode=stream.readUByte(), definition=SCRIPT_OPCODE_SCHEMA[opcode];
    if (!definition || definition.status !== 'supported') fail({...context,offset:start}, `unknown or unsupported opcode ${opcode}`);
    const params=definition.arguments.flatMap(argument => decodeArgument(stream,argument));
    return {opcode,params,size:stream.position-start};
  } catch (error) {
    if (error instanceof RangeError) fail({...context,offset:start}, `truncated ${SCRIPT_OPCODE_SCHEMA[stream.view.getUint8(start)]?.name ?? 'instruction'}`);
    throw error;
  }
}

function writeNumber(writer: BinaryWriter, kind: ArgumentKind, value: number) {
  switch(kind) {
    case 'u8': case 's8': writer.writeUByte(value); break;
    case 'u16be': case 's16be': writer.writeUByte(value>>>8).writeUByte(value); break;
    case 'u32be': case 's32be': writer.writeUByte(value>>>24).writeUByte(value>>>16).writeUByte(value>>>8).writeUByte(value); break;
  }
}
function consumeCount(kind: ArgumentKind, params: number[], index: number): number {
  if (bounds[kind]) return 1;
  if (kind==='eval' || kind==='lerpSprite' || kind==='debugString') return params.length-index;
  if (kind==='lootList') return 1+(params[index] ?? 0);
  return 3;
}
function encodeArgument(writer: BinaryWriter, descriptor: ScriptArgumentDescriptor, params: number[], index: number): number {
  const count=consumeCount(descriptor.kind,params,index), values=params.slice(index,index+count);
  if (bounds[descriptor.kind]) writeNumber(writer,descriptor.kind,values[0]);
  else if (descriptor.kind==='lootList') { writer.writeUByte(values[0]); for(const v of values.slice(1)) writeNumber(writer,'u16be',v); }
  else if (descriptor.kind==='dropMonsterItem') { const [loc,type,amount]=values; writeNumber(writer,'u16be',type>255?loc|0x8000:loc&0x7fff); if(type>255) writeNumber(writer,'u16be',type); else writer.writeUByte(type); writer.writeUByte(amount); }
  else for(const value of values) writer.writeUByte(value);
  return count;
}

export function validateInstruction(instruction: Pick<ScriptInstruction,'opcode'|'params'>, _context: ScriptCodecContext = {}): string[] {
  const definition=SCRIPT_OPCODE_SCHEMA[instruction.opcode], errors:string[]=[];
  if (!definition || definition.status!=='supported') return [`Unknown or unsupported opcode ${instruction.opcode}`];
  let index=0;
  for(const argument of definition.arguments) {
    const count=consumeCount(argument.kind,instruction.params,index);
    if (index+count>instruction.params.length || count<=0) { errors.push(`${argument.name}: missing parameters`); break; }
    const range=bounds[argument.kind]; if(range) { const value=instruction.params[index]; if(!Number.isInteger(value)||value<range[0]||value>range[1]) errors.push(`${argument.name}: ${value} outside ${argument.kind} range`); }
    if(argument.kind==='lootList' && instruction.params[index]!==count-1) errors.push(`${argument.name}: loot count mismatch`);
    if(argument.kind==='eval' && instruction.params[index] < 0) errors.push(`${argument.name}: invalid expression length`);
    index+=count;
  }
  if(index!==instruction.params.length) errors.push(`Expected ${index} parameter values, got ${instruction.params.length}`);
  return errors;
}
export function calculateInstructionSize(instruction: Pick<ScriptInstruction,'opcode'|'params'>): number {
  const writer=new BinaryWriter(16,false); encodeInstruction(writer,instruction,{}); return writer.position;
}
export function encodeInstruction(writer: BinaryWriter, instruction: Pick<ScriptInstruction,'opcode'|'params'>, context: ScriptCodecContext = {}): void {
  const errors=validateInstruction(instruction,context); if(errors.length) fail(context,errors.join('; '));
  writer.writeUByte(instruction.opcode); let index=0;
  for(const argument of SCRIPT_OPCODE_SCHEMA[instruction.opcode].arguments) index+=encodeArgument(writer,argument,instruction.params,index);
}
