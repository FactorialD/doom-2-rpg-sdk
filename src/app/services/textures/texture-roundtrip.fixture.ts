import { BinaryWriter } from '../../utils/byte-stream';
import { SpriteCodec } from '../../logic/sprite-codec';

export function createTextureRoundTripFixture() {
    const mappings = new Int16Array(512).fill(6);
    mappings[0] = 0;
    mappings[1] = 7;
    const dimensions = new Uint8Array(1024);
    dimensions.set([0x22, 0x22, 0x33, 0x77, 0x77, 0x00, 0x00]);
    const bounds = new Uint8Array(4096);
    bounds.set([0, 4, 0, 4], 0);
    bounds.set([1, 4, 1, 4], 4);
    bounds.set([0, 8, 0, 8], 8);

    const spritePixels = new Uint8Array(64);
    spritePixels[0] = 3;
    spritePixels[63] = 0xFF;
    const sprite = SpriteCodec.compressSprite(spritePixels, 8, 8).data;
    const rawRoot = new Uint8Array([0, 1, 2, 3]);
    const fillerA = new Uint8Array(16384).fill(4);
    const fillerB = new Uint8Array(32768 - rawRoot.length - sprite.length - fillerA.length).fill(4);
    const boundaryTexture = new Uint8Array([5]);
    const nextFileTexture = new Uint8Array([6]);

    const texelSizes = new Int16Array(1024);
    texelSizes.fill(0x8000);
    texelSizes[0] = rawRoot.length - 1;
    texelSizes[1] = 0x8000;
    texelSizes[2] = sprite.length - 1;
    texelSizes[3] = fillerA.length - 1;
    texelSizes[4] = fillerB.length - 1;
    texelSizes[5] = boundaryTexture.length - 1;
    texelSizes[6] = nextFileTexture.length - 1;

    const palColors = new Int16Array(1024);
    palColors.fill(0x8000);
    palColors[0] = 4;
    palColors[1] = 0x8000;
    palColors[2] = 0x8000;

    const writer = new BinaryWriter(10_000);
    for (const value of mappings) writer.writeShort(value);
    writer.writeBytes(dimensions);
    writer.writeBytes(bounds);
    for (const value of palColors) writer.writeShort(value);
    for (const value of texelSizes) writer.writeShort(value);

    const tex00 = new Uint8Array(32769);
    let offset = 0;
    for (const part of [rawRoot, sprite, fillerA, fillerB, boundaryTexture]) {
        tex00.set(part, offset);
        offset += part.length;
    }
    const palettes = new Uint8Array([0x00, 0x00, 0x00, 0x7c, 0xe0, 0x03, 0x1f, 0x00]);
    return {
        files: new Map<string, ArrayBuffer>([
            ['newMappings.bin', writer.getData().buffer],
            ['newPalettes.bin', palettes.buffer],
            ['tex00.bin', tex00.buffer],
            ['tex01.bin', nextFileTexture.buffer]
        ]),
        mappings, dimensions, bounds, palColors, texelSizes, spritePixels
    };
}
