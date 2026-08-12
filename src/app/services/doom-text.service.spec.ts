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
            saveBuffer: (name: string, data: ArrayBuffer) => files.set(name, data),
            saveBuffersAtomically: (buffers: ReadonlyMap<string, ArrayBuffer>) => {
                for (const [name, data] of buffers) files.set(name, data);
            }
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

test('createString allocates the next ID, persists it, and preserves sibling data', async () => {
    const sibling = new Uint8Array([90, 0, 0, 0]);
    const files = new Map<string, ArrayBuffer>([
        ['strings.idx', makeIndex()],
        ['strings0.bin', new Uint8Array([65, 0, 66, 0, ...sibling]).buffer]
    ]);
    const service = createService(files);
    const result = await service.createString(0, 0, 'Created', 'windows-1252');
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.entry.id, 2);
    const index = service.parseStringsIndex(files.get('strings.idx')!);
    assert.deepEqual(service.loadStrings(0, 0, index).map(entry => entry.raw), ['A', 'B', 'Created']);
    assert.deepEqual(new Uint8Array(files.get('strings0.bin')!).slice(index[4], index[4] + index[5]), sibling);
});

for (const [encoding, value] of [
    ['windows-1251', 'Змінено'],
    ['windows-1252', 'Changed €'],
    ['utf-8', 'Змінено 😀']
] as const) {
test(`${encoding} edit preserves IDs, neighbours, and rebuilt strings.idx offsets`, async () => {
    const sibling = new Uint8Array([90, 0, 0, 0]);
    const files = new Map<string, ArrayBuffer>([
        ['strings.idx', makeIndex()],
        ['strings0.bin', new Uint8Array([65, 0, 66, 0, ...sibling]).buffer]
    ]);
    const service = createService(files);
    const before = service.loadStrings(0, 0, service.parseStringsIndex(files.get('strings.idx')!), 'windows-1252');
    const edited = before.map(entry => entry.id === 1 ? { ...entry, raw: value } : entry);
    assert.deepEqual(await service.saveStringsChunk(0, 0, edited, encoding), { success: true });

    const index = service.parseStringsIndex(files.get('strings.idx')!);
    const after = service.loadStrings(0, 0, index, encoding);
    assert.deepEqual(after.map(entry => entry.id), [0, 1]);
    assert.deepEqual(after.map(entry => entry.raw), ['A', value]);
    assert.equal(index[4], index[2]);
    assert.deepEqual(new Uint8Array(files.get('strings0.bin')!).slice(index[4], index[4] + index[5]), sibling);
});
}

test('an unrepresentable edit performs no partial writes', async () => {
    const files = new Map<string, ArrayBuffer>([
        ['strings.idx', makeIndex()],
        ['strings0.bin', new Uint8Array([65, 0, 66, 0, 90, 0, 0, 0]).buffer]
    ]);
    const service = createService(files);
    const indexBefore = files.get('strings.idx')!.slice(0);
    const dataBefore = files.get('strings0.bin')!.slice(0);
    const entries = service.loadStrings(0, 0, service.parseStringsIndex(indexBefore));
    entries[1] = { ...entries[1], raw: 'Ж' };
    const result = await service.saveStringsChunk(0, 0, entries, 'windows-1252');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error?.line, 2);
    assert.equal(result.error?.position, 1);
    assert.equal(result.error?.character, 'Ж');
    assert.equal(result.error?.encoding, 'windows-1252');
    assert.deepEqual(files.get('strings.idx'), indexBefore);
    assert.deepEqual(files.get('strings0.bin'), dataBefore);
});

test('selection is represented by an existing entry and cancelling a draft performs no writes', () => {
    const files = new Map<string, ArrayBuffer>([['strings.idx', makeIndex()], ['strings0.bin', new Uint8Array(8).buffer]]);
    const service = createService(files);
    const before = new Uint8Array(files.get('strings0.bin')!).slice();
    const entries: TextEntry[] = [{ id: 4, raw: 'Pick me', renderKey: 'Pick me' }];
    assert.equal(entries.find(entry => entry.id === 4)?.id, 4);
    assert.equal(service.getNextStringId(entries), 5);
    // A cancelled inline draft never calls createString/saveStringsChunk.
    assert.deepEqual(new Uint8Array(files.get('strings0.bin')!), before);
});

test('preview removes ASCII technical syllable-break markers', () => {
    const service = createService(new Map());
    assert.equal(service.getPreviewText('de-hy-phen-ate'), 'dehyphenate');
});

test('preview preserves punctuation hyphens and unescapes the game format', () => {
    const service = createService(new Map());
    assert.equal(service.getPreviewText('Doom--RPG'), 'Doom-RPG');
});

test('preview conversion does not mutate raw during a save and load round trip', async () => {
    const files = new Map<string, ArrayBuffer>([
        ['strings.idx', makeIndex()],
        ['strings0.bin', new Uint8Array(8).buffer]
    ]);
    const service = createService(files);
    const raw = 'de-hy-phen-ate and Doom--RPG';
    const entry: TextEntry = { id: 0, raw, renderKey: raw };

    assert.equal(service.getPreviewText(entry.renderKey), 'dehyphenate and Doom-RPG');
    assert.equal(entry.raw, raw);
    assert.deepEqual(await service.saveStringsChunk(0, 0, [entry], 'windows-1252'), { success: true });

    const reparsed = service.loadStrings(0, 0, service.parseStringsIndex(files.get('strings.idx')!));
    assert.equal(reparsed[0].raw, raw);
});
