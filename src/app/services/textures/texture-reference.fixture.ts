import { SpriteCodec } from '../../logic/sprite-codec';

/** Two frames which intentionally interpret one compressed texel buffer differently. */
export function createSharedTexelReferenceFixture() {
    const pixels = new Uint8Array(8 * 4);
    pixels[2] = 7;
    pixels[3] = 8;
    pixels[8 + 2] = 9;
    pixels[8 + 3] = 10;
    const compressed = SpriteCodec.compressSprite(pixels, 8, 4).data;

    const mediaMappings = new Int16Array(512).fill(2);
    mediaMappings[0] = 0;
    mediaMappings[1] = 2;

    const mediaDimensions = new Uint8Array(1024);
    mediaDimensions[0] = 0x22; // 4 x 4 parent frame
    mediaDimensions[1] = 0x32; // 8 x 4 reference frame

    const mediaBounds = new Uint8Array(4096);
    mediaBounds.set([0, 2, 0, 2], 0);
    mediaBounds.set([2, 4, 0, 2], 4);

    const mediaTexelSizes = new Int16Array(1024);
    mediaTexelSizes[0] = compressed.length - 1;
    mediaTexelSizes[1] = 0x8000;

    return { compressed, mediaMappings, mediaDimensions, mediaBounds, mediaTexelSizes };
}
