import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptCompilerService } from './script-compiler.service.ts';
import { ByteStream } from '../../utils/byte-stream.ts';
import { decodeInstruction } from './script-instruction-codec.ts';
import type { ScriptInstruction } from './script-types.ts';

const instruction = (uid: string, opcode: number, params: number[], jumpTargetUid?: string) => ({
    uid, opcode, params, jumpTargetUid, offset: 0, size: 0
} as ScriptInstruction);

function decode(binary: Uint8Array) {
    const stream = new ByteStream(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), false);
    const result = [];
    while (stream.position < stream.length) result.push(decodeInstruction(stream));
    return result;
}

test('insert and delete relocate relative jumps, static functions, and tile events', () => {
    const compiler = new ScriptCompilerService();
    const start = instruction('start', 1, [0], 'return');
    const ret = instruction('return', 2, []);
    const refs = { 0: 'return' };
    const events = [{ uid: 'event-1', tileIndex: 37, targetUid: 'return', flags: 0xff4 }];

    const initial = compiler.compile([start, ret], refs, events, new Int32Array());
    assert.deepEqual(initial.errors, []);
    assert.equal(decode(initial.binary)[0].params[0], 0);
    assert.equal(initial.newStaticFuncs[0], 3);
    assert.equal(initial.newTileEvents[0] >>> 16, 3);

    const inserted = instruction('message', 3, [0x1234]);
    const afterInsert = compiler.compile([start, inserted, ret], refs, events, initial.newTileEvents);
    assert.equal(decode(afterInsert.binary)[0].params[0], 3);
    assert.equal(afterInsert.newStaticFuncs[0], 6);
    assert.equal(afterInsert.newTileEvents[0] >>> 16, 6);
    assert.equal(afterInsert.newTileEvents[0] & 0xffff, 37);
    assert.equal(afterInsert.newTileEvents[1], 0xff4);

    const afterDelete = compiler.compile([start, ret], refs, events, afterInsert.newTileEvents);
    assert.deepEqual(Array.from(afterDelete.binary), Array.from(initial.binary));
    assert.equal(afterDelete.newStaticFuncs[0], 3);
    assert.equal(afterDelete.newTileEvents[0] >>> 16, 3);
});

test('compiles multiple events for one tile and rejects invalid or duplicate references', () => {
    const compiler = new ScriptCompilerService();
    const ret = instruction('return', 2, []);
    const valid = compiler.compile([ret], {}, [
        { uid: 'a', tileIndex: 12, targetUid: 'return', flags: 0xff1 },
        { uid: 'b', tileIndex: 12, targetUid: 'return', flags: 0xff4 }
    ], new Int32Array());
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.newTileEvents.length, 4);

    const invalid = compiler.compile([ret], {}, [
        { uid: 'a', tileIndex: 1024, targetUid: 'missing', flags: 0x80000 },
        { uid: 'a', tileIndex: 12, targetUid: 'return', flags: 0xff4 }
    ], new Int32Array());
    assert.ok(invalid.errors.some(error => error.includes('Invalid tile index')));
    assert.ok(invalid.errors.some(error => error.includes('Duplicate')));
});
