import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomTextService, type TextEntry } from './doom-text.service.ts';

function makeIndex(): ArrayBuffer {
    const buffer = new ArrayBuffer(2 + 3 * 5);
    const view = new DataView(buffer);
    view.setInt16(0, 2, true);
    view.setUint8(2, 0); view.setInt32(3, 0, true);
    view.setUint8(7, 0); view.setInt32(8, 4, true);
    view.setUint8(12, 255); view.setInt32(13, 8, true);
    return buffer;
}

function createService(files: Map<string, ArrayBuffer>) {
    const service = Object.create(DoomTextService.prototype) as DoomTextService;
    Object.assign(service, {
        fileService: {
            getFile: (name: string) => files.get(name),
            saveBuffer: (name: string, data: ArrayBuffer) => files.set(name, data)
        }
    });
    return service;
}

for (const [encoding, value] of [
    ['windows-1251', 'Привіт Ё №'],
    ['windows-1252', 'café € Œ'],
    ['utf-8', 'Україна 😀']
] as const) {
    test(`${encoding} text saves and reparses exactly without changing its sibling chunk`, async () => {
        const untouched = new Uint8Array([0xaa, 0xbb, 0xcc, 0]);
        const files = new Map<string, ArrayBuffer>([
            ['strings.idx', makeIndex()],
            ['strings0.bin', new Uint8Array([65, 0, 0, 0, ...untouched]).buffer]
        ]);
        const service = createService(files);
        const result = await service.saveStringsChunk(0, 0, [{ id: 0, raw: value, renderKey: '' } satisfies TextEntry], encoding);
        assert.deepEqual(result, { success: true });

        const index = service.parseStringsIndex(files.get('strings.idx')!);
        assert.equal(index[1], 0);
        assert.deepEqual(new Uint8Array(files.get('strings0.bin')!).slice(index[4], index[4] + index[5]), untouched);
        assert.equal(service.loadStrings(0, 0, index, encoding)[0].raw, value);
    });
}
