import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptEntryNameService } from './script-entry-name.service';
import type { ScriptData } from '../doom-script.service';

const instruction = (uid: string, offset: number) => ({ uid, offset, opcode: 2, name: 'EV_RETURN', params: [], formattedArgs: '', isJump: false, size: 1, originalBytes: [2], readableName: '', readableDetails: '', description: '', isLogic: false });
const fixture = (): ScriptData => ({ mapId: 3, instructions: [instruction('a', 0), instruction('b', 8), instruction('c', 12)], staticFuncs: { 0: 'a', 1: 'b', 2: 'b' }, staticFuncOffsets: [0, 8, 8, 0xffff], rawSize: 13, tileEvents: new Int32Array(), tileEventRefs: [{ uid: 'event', tileIndex: 67, targetUid: 'b', flags: 0xff4 }] });

test('resolver deduplicates coincident entry points and keeps technical function labels', () => {
  const resolver = new ScriptEntryNameService();
  const data = fixture();
  resolver.rename(3, 'b', 'Open laboratory');
  assert.deepEqual(resolver.labels(data, data.instructions[1]), ['Open laboratory', 'Func #1', 'Func #2', 'Use (3, 2)']);
  assert.equal(resolver.display(data, data.instructions[1]), 'Open laboratory · Func #1 · Func #2 · Use (3, 2) · 0x0008');
});

test('reference options retain unused function gaps and update after insertion, movement and relocation', () => {
  const resolver = new ScriptEntryNameService();
  const data = fixture();
  assert.equal(data.staticFuncOffsets[3], 0xffff);
  resolver.rename(3, 'b', 'Handler');
  data.instructions.splice(1, 0, instruction('inserted', 4));
  data.instructions[2].offset = 9;
  let options = resolver.buildInstructionOptions(data, 5);
  assert.deepEqual(options.map(option => option.value), [-5, -1, 4, 7]);
  assert.match(options[2].label, /^Handler · Func #1/);
  const [moved] = data.instructions.splice(2, 1);
  data.instructions.push(moved);
  moved.offset = 20;
  options = resolver.buildInstructionOptions(data);
  assert.equal(options.at(-1)?.label.endsWith('0x0014'), true);
});

test('deleted UID metadata is restored to a replacement or cleaned when no target exists', () => {
  const resolver = new ScriptEntryNameService();
  const data = fixture();
  resolver.rename(3, 'b', 'Handler');
  data.instructions.splice(1, 1);
  resolver.reconcile(data, new Map([['b', 'c']]));
  assert.equal(resolver.get(3, 'b'), undefined);
  assert.equal(resolver.get(3, 'c'), 'Handler');
  data.instructions.splice(data.instructions.findIndex(item => item.uid === 'c'), 1);
  resolver.reconcile(data);
  assert.equal(resolver.get(3, 'c'), undefined);
});
