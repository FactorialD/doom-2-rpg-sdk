import assert from 'node:assert/strict';
import test from 'node:test';
import { TexturePaletteService } from './texture-palette.service.ts';

function signalStub() {
    let value = 0;
    return Object.assign(() => value, { set: (next: number) => { value = Number(next); }, update: (fn: (v: number) => number) => { value = fn(value); } });
}

function makeService(files: Map<string, ArrayBuffer>, palColors: Int16Array) {
    const service = Object.create(TexturePaletteService.prototype) as TexturePaletteService;
    Object.assign(service, {
        fileService: {
            getFile: (name: string) => files.get(name),
            saveBuffer: (name: string, data: ArrayBuffer) => files.set(name, data)
        },
        mappingService: { mediaPalColors: palColors, saveMappingsFile() {} },
        paletteEntries: [], uniquePalettes: new Map(), isLoaded: signalStub(), version: signalStub()
    });
    return service;
}

test('RGB555 palettes round trip and references continue sharing their parent', async () => {
    const palColors = new Int16Array(1024);
    palColors[0] = 2;
    palColors[1] = 0x8000;
    const fixture = new Uint8Array([0x00, 0x7c, 0x1f, 0x00]); // red, blue in RGB555 LE
    const files = new Map([['newPalettes.bin', fixture.buffer]]);
    const service = makeService(files, palColors);

    await service.loadPalettes(palColors);
    assert.strictEqual(service.getPalette(1), service.getPalette(0));
    assert.deepEqual(Array.from(service.getUsage(1)), [0, 1]);
    assert.equal(service.savePalettes(), true);
    assert.deepEqual(new Uint8Array(files.get('newPalettes.bin')!), fixture);

    const reparsed = makeService(files, palColors);
    await reparsed.loadPalettes(palColors);
    assert.deepEqual(reparsed.getPalette(0), service.getPalette(0));
    assert.strictEqual(reparsed.getPalette(1), reparsed.getPalette(0));
});
