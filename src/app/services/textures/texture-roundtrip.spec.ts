import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomTextureService } from '../doom-texture.service.ts';
import { TextureMappingService } from './texture-mapping.service.ts';
import { TexturePaletteService } from './texture-palette.service.ts';
import { createTextureRoundTripFixture } from './texture-roundtrip.fixture.ts';

const signalStub = <T>(initial: T) => {
    let value = initial;
    return Object.assign(() => value, { set: (next: T) => { value = next; }, update: (fn: (old: T) => T) => { value = fn(value); } });
};

function parse(files: Map<string, ArrayBuffer>) {
    const fileService = {
        getFile: (name: string) => files.get(name),
        saveBuffer: (name: string, data: ArrayBuffer) => files.set(name, data)
    };
    const mapping = Object.create(TextureMappingService.prototype) as TextureMappingService;
    Object.assign(mapping, { fileService, groupToTextureMap: new Map(), textureLocations: [] });
    assert.equal(mapping.loadMappings(), true);
    const palette = Object.create(TexturePaletteService.prototype) as TexturePaletteService;
    Object.assign(palette, { fileService, mappingService: mapping, paletteEntries: [], uniquePalettes: new Map(), isLoaded: signalStub(false), version: signalStub(0) });
    const texture = Object.create(DoomTextureService.prototype) as DoomTextureService;
    Object.assign(texture, { fileService, mappingService: mapping, paletteService: palette,
        textureList: signalStub(mapping.getAllTextures()), textureVersion: signalStub(0) });
    return { mapping, palette, texture };
}

test('complete mapping, palette, compressed/raw texel fixture reparses after Save', async () => {
    const fixture = createTextureRoundTripFixture();
    const first = parse(fixture.files);
    await first.palette.loadPalettes(first.mapping.mediaPalColors!);
    assert.deepEqual(first.texture.getTextureRawIndices(2), fixture.spritePixels);
    assert.deepEqual(
        [0, 1, 2, 3, 4, 5, 6].map(id => {
            const t = first.mapping.getTextureById(id)!;
            return [t.fileIndex, t.fileOffset, t.dataLength];
        }),
        [[0, 0, 4], [0, 0, 4], [0, 4, 12], [0, 16, 16384], [0, 16400, 16368], [0, 32768, 1], [1, 0, 1]]
    );

    const edited = fixture.spritePixels.slice();
    edited[9] = 7;
    assert.equal(first.texture.saveTexture(2, edited), true);
    assert.equal(first.palette.savePalettes(), true);

    const second = parse(fixture.files);
    await second.palette.loadPalettes(second.mapping.mediaPalColors!);
    assert.deepEqual(second.texture.getTextureRawIndices(2), edited);
    assert.deepEqual(second.mapping.mediaMappings, fixture.mappings);
    assert.deepEqual(second.mapping.mediaDimensions, fixture.dimensions);
    assert.deepEqual(second.mapping.mediaPalColors, fixture.palColors);
    assert.deepEqual(second.mapping.mediaBounds!.slice(0, 8), fixture.bounds.slice(0, 8));
    assert.deepEqual(second.mapping.getTextureById(2)!.bounds, { minX: 0, maxX: 8, minY: 0, maxY: 8 });
    const savedSpriteLength = second.mapping.getTextureById(2)!.dataLength;
    assert.equal(second.mapping.mediaTexelSizes![2] & 0x3fff, savedSpriteLength - 1);
    assert.deepEqual(
        [0, 1, 2, 3, 4, 5, 6].map(id => {
            const t = second.mapping.getTextureById(id)!;
            return [t.isReference, t.fileIndex, t.fileOffset, t.dataLength];
        }),
        [
            [false, 0, 0, 4],
            [true, 0, 0, 4],
            [false, 0, 4, savedSpriteLength],
            [false, 0, 4 + savedSpriteLength, 16384],
            [false, 0, 4 + savedSpriteLength + 16384, 16368],
            [false, 1, 0, 1],
            [false, 1, 1, 1]
        ]
    );
    assert.deepEqual(second.palette.getPalette(1), second.palette.getPalette(0));
});
