import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomFileService } from '../doom-file.service.ts';
import { DoomScriptService, ScriptData } from '../doom-script.service.ts';
import { ScriptAssemblerService } from './script-assembler.service.ts';
import { ScriptCompilerService } from './script-compiler.service.ts';
import { ScriptDisassemblerService } from './script-disassembler.service.ts';
import { applyFixtureUids, fixtureTileEventRefs, SYNTHETIC_SCRIPT_FIXTURE } from './script-fixtures.ts';
import type { ScriptInstruction } from './script-types.ts';

function services() {
  const disassembler = Object.create(ScriptDisassemblerService.prototype) as ScriptDisassemblerService;
  Object.assign(disassembler, {
    entityService: { findItemDef: () => undefined },
    textService: { getStringValue: (_chunk: number, id: number) => `STR_${id}` }
  });
  const compiler = new ScriptCompilerService();
  const assembler = new ScriptAssemblerService();
  const doom = Object.create(DoomScriptService.prototype) as DoomScriptService;
  Object.assign(doom, { disassembler, compiler });
  return { disassembler, compiler, assembler, doom };
}

function fixtureData(disassembler: ScriptDisassemblerService): ScriptData {
  const instructions = applyFixtureUids(disassembler.disassemble(SYNTHETIC_SCRIPT_FIXTURE.bytecode, 1));
  return {
    mapId: 1,
    instructions,
    staticFuncs: { ...SYNTHETIC_SCRIPT_FIXTURE.staticFuncs },
    staticFuncOffsets: [],
    rawSize: SYNTHETIC_SCRIPT_FIXTURE.bytecode.length,
    tileEvents: new Int32Array(),
    tileEventRefs: fixtureTileEventRefs(instructions)
  };
}

function assertRoundTrip(data: ScriptData, compiler: ScriptCompilerService, disassembler: ScriptDisassemblerService) {
  const expectedEdges = new Map(data.instructions.filter(i => i.jumpTargetUid).map(i => [i.uid, i.jumpTargetUid]));
  const result = compiler.compile(data.instructions, data.staticFuncs, data.tileEventRefs, data.tileEvents);
  assert.deepEqual(result.errors, []);
  const decoded = disassembler.disassemble(result.binary, data.mapId);
  const offsetToUid = new Map(data.instructions.map(i => [i.offset, i.uid]));
  decoded.forEach((instruction, index) => {
    const sourceUid = data.instructions[index].uid;
    if (expectedEdges.has(sourceUid)) assert.equal(offsetToUid.get(instruction.jumpTarget!), expectedEdges.get(sourceUid));
  });
  for (const [index, uid] of Object.entries(data.staticFuncs)) {
    assert.equal(result.newStaticFuncs[Number(index)], data.instructions.find(i => i.uid === uid)?.offset);
  }
  data.tileEventRefs.forEach((event, index) => {
    assert.equal((result.newTileEvents[index * 2] >>> 16) & 0xffff, data.instructions.find(i => i.uid === event.targetUid)?.offset);
    assert.equal(result.newTileEvents[index * 2] & 0xffff, event.tileIndex);
    assert.equal(result.newTileEvents[index * 2 + 1], event.flags);
  });
  data.tileEvents = result.newTileEvents;
}

test('public script APIs preserve logical targets through edit, insert, delete, and reorder', () => {
  const { disassembler, compiler, assembler, doom } = services();
  const data = fixtureData(disassembler);
  assert.equal(data.instructions[1].referencedEntityId, 7);
  assert.equal(data.instructions[2].size, 3);
  assertRoundTrip(data, compiler, disassembler);

  const edit = assembler.assemble(24, '9');
  assert.equal(edit.error, undefined);
  doom.updateInstruction(data, data.instructions[1], edit.bytes);
  assertRoundTrip(data, compiler, disassembler);

  const before = assembler.assemble(14, '4');
  doom.insertInstruction(data, data.instructions[2].offset, before.bytes, 'before');
  const beforeUid = data.instructions[2].uid;
  assertRoundTrip(data, compiler, disassembler);

  const after = assembler.assemble(33, '1 2 3');
  doom.insertInstruction(data, data.instructions[2].offset, after.bytes, 'after');
  const afterUid = data.instructions[3].uid;
  assertRoundTrip(data, compiler, disassembler);

  doom.deleteInstruction(data, data.instructions.find(i => i.uid === beforeUid)!);
  assertRoundTrip(data, compiler, disassembler);

  doom.moveInstruction(data, afterUid, 'last-return', 'before');
  assertRoundTrip(data, compiler, disassembler);
});

test('rejects malformed scripts, invalid targets, reserved opcodes, and operand overflow', () => {
  const { disassembler, compiler, assembler, doom } = services();
  assert.throws(() => disassembler.disassemble(new Uint8Array([3, 0]), 1), /truncated EV_MESSAGE/);
  assert.throws(() => disassembler.disassemble(new Uint8Array([63]), 1), /unknown or unsupported opcode 63/);
  assert.match(assembler.assemble(14, '256').error!, /outside u8 range/);
  assert.match(assembler.assemble(63, '').error!, /Unknown opcode/);

  const middleTarget = disassembler.disassemble(new Uint8Array([1, 0, 1, 3, 0, 1, 2]), 1);
  assert.ok(compiler.compile(middleTarget, {}, [], new Int32Array()).errors.some(error => error.includes('Broken Link')));

  const data = fixtureData(disassembler);
  const target = data.instructions.find(i => i.uid === 'entity')!;
  doom.deleteInstruction(data, target);
  assert.ok(compiler.compile(data.instructions, data.staticFuncs, data.tileEventRefs, data.tileEvents).errors.some(error => error.includes('Broken Link')));
});

test('failed DoomScriptService save leaves every DoomFileService buffer unchanged', async () => {
  const { disassembler, compiler, doom } = services();
  const files = new DoomFileService();
  const sentinel = new Uint8Array([10, 20, 30, 40]).buffer;
  files.saveBuffer('map00.bin', sentinel);
  files.saveBuffer('unrelated.bin', new Uint8Array([99]).buffer);
  Object.assign(doom, { fileService: files });
  const data = fixtureData(disassembler);
  data.instructions[0].jumpTargetUid = 'deleted-target';
  const before = new Map([...files.files].map(([name, buffer]) => [name, Array.from(new Uint8Array(buffer))]));
  const oldAlert = globalThis.alert;
  globalThis.alert = () => undefined;
  try {
    assert.equal(await doom.saveScriptChanges(data), false);
  } finally {
    globalThis.alert = oldAlert;
  }
  assert.deepEqual(new Map([...files.files].map(([name, buffer]) => [name, Array.from(new Uint8Array(buffer))])), before);
  assert.ok(compiler.compile(data.instructions, data.staticFuncs, data.tileEventRefs, data.tileEvents).errors.length > 0);
});
