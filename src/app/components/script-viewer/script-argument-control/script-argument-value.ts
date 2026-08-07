import { ArgumentKind, ScriptArgumentDescriptor } from '../../../services/scripts/script-opcode-schema';

export interface ScriptArgumentValue {
  descriptor: ScriptArgumentDescriptor;
  /** Raw values consumed by the bytecode codec. The first value contains a primitive reference. */
  rawValues: number[];
  value: number;
  error: string;
}

const ranges: Partial<Record<ArgumentKind, readonly [number, number]>> = {
  u8: [0, 255], s8: [-128, 127], u16be: [0, 65535], s16be: [-32768, 32767],
  u32be: [0, 0xffffffff], s32be: [-0x80000000, 0x7fffffff]
};

function argumentLength(kind: ArgumentKind, params: readonly number[], index: number): number {
  if (ranges[kind]) return 1;
  if (kind === 'lootList') return 1 + (params[index] ?? 0);
  if (kind === 'dropMonsterItem') return 3;
  // eval, lerpSprite and debugString are currently terminal, variable-width codecs.
  return Math.max(1, params.length - index);
}

export function validateScriptArgument(control: ScriptArgumentValue): string {
  const { descriptor, value } = control;
  if (!Number.isInteger(value)) return `${descriptor.name} must be an integer`;
  const codecRange = ranges[descriptor.kind];
  const min = descriptor.min ?? descriptor.packedReference?.min ?? codecRange?.[0];
  const max = descriptor.max ?? descriptor.packedReference?.max ?? codecRange?.[1];
  if (min !== undefined && value < min) return `${descriptor.name} must be at least ${min}`;
  if (max !== undefined && value > max) return `${descriptor.name} must be at most ${max}`;
  return '';
}

export function createScriptArgumentValues(
  descriptors: readonly ScriptArgumentDescriptor[], params: readonly number[]
): ScriptArgumentValue[] {
  let index = 0;
  return descriptors.map(descriptor => {
    const length = argumentLength(descriptor.kind, params, index);
    const rawValues = params.slice(index, index + length);
    while (rawValues.length < length) rawValues.push(0);
    index += length;
    const raw = rawValues[0] ?? 0;
    const control: ScriptArgumentValue = {
      descriptor, rawValues, value: descriptor.packedReference?.decode(raw) ?? raw, error: ''
    };
    control.error = validateScriptArgument(control);
    return control;
  });
}

export function setScriptArgumentValue(control: ScriptArgumentValue, value: number): ScriptArgumentValue {
  const rawValues = [...control.rawValues];
  rawValues[0] = control.descriptor.packedReference
    ? control.descriptor.packedReference.encode(value, rawValues[0] ?? 0)
    : value;
  const updated = { ...control, rawValues, value, error: '' };
  updated.error = validateScriptArgument(updated);
  return updated;
}

export function scriptArgumentParams(controls: readonly ScriptArgumentValue[]): number[] {
  return controls.flatMap(control => control.rawValues);
}

export function scriptArgumentString(controls: readonly ScriptArgumentValue[]): string {
  return scriptArgumentParams(controls).join(' ');
}
