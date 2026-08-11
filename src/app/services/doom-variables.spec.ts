import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeSetStateAssignment, getVariableMetadata } from './doom-variables';

test('variable edit writes the Java EV_SETSTATE big-endian signed immediate', () => {
  assert.deepEqual(encodeSetStateAssignment({ variableId: 17, value: -2 }), [6, 17, 0xff, 0xfe]);
});

test('SDK labels remain metadata rather than a serialized value field', () => {
  assert.deepEqual(getVariableMetadata(1), { id: 1, sdkName: 'CODEVAR_HEALTH', runtimeOwned: true, storage: 'runtime-state' });
});
