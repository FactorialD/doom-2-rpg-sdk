import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEntityDefinitions, serializeEntityDefinitions } from './doom-entities.service';

test('entities parse, edit, write, and parse preserves every EntityDef field', () => {
  const original = serializeEntityDefinitions([{ index: 0, tileIndex: 300, eType: 6, eSubType: 1, parm: 4, nameId: 7, longNameId: 8, descriptionId: 9 }]);
  const parsed = parseEntityDefinitions(original);
  parsed[0] = { ...parsed[0], parm: -3, descriptionId: 255 };
  assert.deepEqual(parseEntityDefinitions(serializeEntityDefinitions(parsed)), [{ index: 0, tileIndex: 300, eType: 6, eSubType: 1, parm: -3, nameId: 7, longNameId: 8, descriptionId: 255 }]);
});

test('entities serializer rejects values that Java byte fields cannot represent', () => {
  assert.throws(() => serializeEntityDefinitions([{ index: 0, tileIndex: 0, eType: 6, eSubType: 0, parm: 128, nameId: 0, longNameId: 0, descriptionId: 0 }]), /parm/);
});
