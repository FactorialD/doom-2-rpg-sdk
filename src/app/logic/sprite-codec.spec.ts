import assert from 'node:assert/strict';
import test from 'node:test';
import { SpriteCodec } from './sprite-codec.ts';
import { TextureInfo } from '../services/textures/texture-types.ts';

function info(width: number, height: number, bounds: { minX: number; maxX: number; minY: number; maxY: number }): TextureInfo {
    return { id: 0, groupId: 0, width, height, valid: true, isReference: false,
        fileIndex: 0, fileOffset: 0, dataLength: 0, category: 'Sprites', bounds };
}

function assertRoundTrip(name: string, pixels: Uint8Array, width: number, height: number) {
    test(name, () => {
        const encoded = SpriteCodec.compressSprite(pixels, width, height);
        const decoded = new Uint8Array(width * height);
        SpriteCodec.decompressIndices(encoded.data, decoded, info(width, height, encoded.bounds));
        const reencoded = SpriteCodec.compressSprite(decoded, width, height);
        const decodedAgain = new Uint8Array(width * height);
        SpriteCodec.decompressIndices(reencoded.data, decodedAgain, info(width, height, reencoded.bounds));

        assert.deepEqual(decoded, pixels, 'decode preserves every palette index');
        assert.deepEqual(decodedAgain, decoded, 'decode -> encode -> decode is pixel-equivalent');
        assert.deepEqual(reencoded.bounds, encoded.bounds, 'bounds remain structurally equivalent');
        assert.deepEqual(reencoded.data, encoded.data, 'column directory and spans are canonical');
    });
}

assertRoundTrip('empty columns and an entirely transparent sprite', new Uint8Array(8 * 8), 8, 8);

const holesAndFF = new Uint8Array(8 * 8);
holesAndFF[0] = 0xFF; // 0xFF must survive as a texel; only index 0 is transparent.
holesAndFF[7 * 8 + 7] = 1;
assertRoundTrip('transparent index 0, empty interior columns, edge bounds, and 0xFF texels', holesAndFF, 8, 8);

const tall = new Uint8Array(2 * 256);
for (let y = 0; y < 256; y++) tall[y * 2] = (y % 254) + 1;
assertRoundTrip('a 256-pixel column is split without wrapping its byte-sized span length', tall, 2, 256);

test('malformed directory/footer bounds are rejected without reading outside the fixture', () => {
    const output = new Uint8Array(4).fill(9);
    SpriteCodec.decompressIndices(new Uint8Array([0xFF, 0xFF]), output, info(2, 2, { minX: 0, maxX: 2, minY: 0, maxY: 2 }));
    assert.deepEqual(Array.from(output), [9, 9, 9, 9]);
});
