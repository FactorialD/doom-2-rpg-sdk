import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStringChunk, SCRIPT_OPCODE_SCHEMA, ReferenceType, ScriptArgumentDescriptor } from '../../../services/scripts/script-opcode-schema';
import { createScriptArgumentValues, scriptArgumentParams, scriptArgumentString, setScriptArgumentValue } from './script-argument-value';

describe('structured script argument values', () => {
  const referenceCases: Array<[ReferenceType, number]> = [
    ['string-index', 3], ['entity-index', 19], ['sound-index', 37], ['map-index', 11],
    ['tile-event-index', 23], ['instruction-absolute', 36], ['instruction-relative', 1]
  ];

  for (const [reference, opcode] of referenceCases) {
    it(`forms assembler parameters for ${reference}`, () => {
      const descriptors = SCRIPT_OPCODE_SCHEMA[opcode].arguments;
      const original = descriptors.map(() => 0);
      const controls = createScriptArgumentValues(descriptors, original);
      const index = descriptors.findIndex(argument => argument.reference === reference)
        >= 0 ? descriptors.findIndex(argument => argument.reference === reference) : 0;
      controls[index] = setScriptArgumentValue(controls[index], 7);
      assert.equal(scriptArgumentParams(controls)[index], 7);
      assert.equal(scriptArgumentString(controls).split(' ')[index], '7');
    });
  }

  it('round trips ordinary primitive arguments', () => {
    const descriptors = SCRIPT_OPCODE_SCHEMA[20].arguments;
    assert.deepEqual(scriptArgumentParams(createScriptArgumentValues(descriptors, [-1, 2, -3])), [-1, 2, -3]);
  });

  for (const opcode of [38, 51, 61, 75, 83, 95]) {
    it(`preserves unrelated packed bits for opcode ${opcode}`, () => {
      const descriptor = SCRIPT_OPCODE_SCHEMA[opcode].arguments[0];
      const previous = descriptor.kind === 's32be' ? 0x41234567 : 0xa5a5;
      const control = createScriptArgumentValues([descriptor], [previous])[0];
      const updated = setScriptArgumentValue(control, 3);
      const expected = descriptor.packedReference!.encode(3, previous);
      assert.equal(scriptArgumentParams([updated])[0], expected);
      const referenceMaskResult = descriptor.packedReference!.encode(control.value, expected);
      assert.equal(referenceMaskResult, previous);
    });
  }

  it('uses a packed codec without replacing subsequent values', () => {
    const descriptor: ScriptArgumentDescriptor = SCRIPT_OPCODE_SCHEMA[38].arguments[0];
    const controls = createScriptArgumentValues([descriptor], [0xc123]);
    assert.deepEqual(scriptArgumentParams([setScriptArgumentValue(controls[0], 5)]), [0xc005]);
  });

  it('resolves every string opcode through the map chunk declared by the schema', () => {
    for (const definition of Object.values(SCRIPT_OPCODE_SCHEMA)) {
      if (!definition.arguments.some(argument => argument.reference === 'string-index')) continue;
      assert.equal(resolveStringChunk(definition, 6), 9);
    }
    assert.equal(resolveStringChunk(SCRIPT_OPCODE_SCHEMA[12], 1, [0xc005, 100]), 4);
  });
});
