import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomEntitiesService, parseEntityDefinitions, serializeEntityDefinitions } from './doom-entities.service';

function loadedService(definitions: Parameters<typeof serializeEntityDefinitions>[0]) {
  let stored = serializeEntityDefinitions(definitions);
  let saves = 0;
  const fileService = {
    getFile: () => stored,
    saveBuffersAtomically: (buffers: ReadonlyMap<string, ArrayBuffer>) => { stored = buffers.get('entities.bin')!; saves++; },
    saveBuffer: (_path: string, buffer: ArrayBuffer) => { stored = buffer; saves++; }
  };
  const service = Object.create(DoomEntitiesService.prototype) as DoomEntitiesService;
  Object.assign(service, {
    fileService, entityDefs: [], tileIndexToDefMap: new Map(),
    entityDefsRevision: Object.assign(() => 0, { update: () => undefined }),
    isLoaded: Object.assign(() => false, { set: () => undefined })
  });
  return { service, fileService, getStored: () => stored, getSaves: () => saves };
}

test('entities parse, edit, write, and parse preserves every EntityDef field', () => {
  const original = serializeEntityDefinitions([{ index: 0, tileIndex: 300, eType: 6, eSubType: 1, parm: 4, nameId: 7, longNameId: 8, descriptionId: 9 }]);
  const parsed = parseEntityDefinitions(original);
  parsed[0] = { ...parsed[0], parm: -3, descriptionId: 255 };
  assert.deepEqual(parseEntityDefinitions(serializeEntityDefinitions(parsed)), [{ index: 0, tileIndex: 300, eType: 6, eSubType: 1, parm: -3, nameId: 7, longNameId: 8, descriptionId: 255 }]);
});

test('entities serializer rejects values that Java byte fields cannot represent', () => {
  assert.throws(() => serializeEntityDefinitions([{ index: 0, tileIndex: 0, eType: 6, eSubType: 0, parm: 128, nameId: 0, longNameId: 0, descriptionId: 0 }]), /parm/);
});

test('createDefinition appends and round trips the complete record', async () => {
  const fixture = loadedService([{ index: 0, tileIndex: 10, eType: 2, eSubType: 0, parm: 1, nameId: 2, longNameId: 3, descriptionId: 4 }]);
  await fixture.service.loadEntities();
  const created = fixture.service.createDefinition({ tileIndex: 11, eType: 3, eSubType: -2, parm: 127, nameId: 253, longNameId: 254, descriptionId: 255 });
  assert.equal(created.index, 1);
  assert.deepEqual(parseEntityDefinitions(fixture.getStored()), [fixture.service.getDef(0), created]);
  assert.equal(fixture.getSaves(), 1);
});

test('createDefinition rejects a duplicate tileIndex because Java lookup returns the first match', async () => {
  const fixture = loadedService([{ index: 0, tileIndex: 10, eType: 2, eSubType: 0, parm: 1, nameId: 2, longNameId: 3, descriptionId: 4 }]);
  await fixture.service.loadEntities();
  assert.throws(() => fixture.service.createDefinition({ tileIndex: 10, eType: 3, eSubType: 0, parm: 0, nameId: 0, longNameId: 0, descriptionId: 0 }), /already used/);
  assert.equal(fixture.getSaves(), 0);
});

test('entity serializer accepts exact signed and unsigned field boundaries', () => {
  const extremes = [
    { index: 0, tileIndex: -32768, eType: -128, eSubType: -128, parm: -128, nameId: 0, longNameId: 0, descriptionId: 0 },
    { index: 1, tileIndex: 32767, eType: 127, eSubType: 127, parm: 127, nameId: 255, longNameId: 255, descriptionId: 255 }
  ];
  assert.deepEqual(parseEntityDefinitions(serializeEntityDefinitions(extremes)), extremes);
  assert.throws(() => serializeEntityDefinitions(new Array(0x8000).fill(extremes[0])), /32767/);
});

test('failed create serialization does not mutate definitions or the VFS', async () => {
  const original = [{ index: 0, tileIndex: 10, eType: 2, eSubType: 0, parm: 1, nameId: 2, longNameId: 3, descriptionId: 4 }];
  const fixture = loadedService(original);
  await fixture.service.loadEntities();
  const before = fixture.getStored();
  assert.throws(() => fixture.service.createDefinition({ tileIndex: 11, eType: 128, eSubType: 0, parm: 0, nameId: 0, longNameId: 0, descriptionId: 0 }), /eType/);
  assert.equal(fixture.getStored(), before);
  assert.deepEqual(fixture.service.getAllDefs(), original);
  assert.equal(fixture.getSaves(), 0);
});
