import { describe, expect, mock, test } from 'bun:test';
import type { DoomTextureService as DoomTextureServiceType } from '../doom-texture.service';
import type { TextureMappingService as TextureMappingServiceType } from './texture-mapping.service';
import { createSharedTexelReferenceFixture } from './texture-reference.fixture';

mock.module('@angular/core', () => ({
    Injectable: () => (target: unknown) => target,
    inject: () => undefined,
    signal: (initial: unknown) => Object.assign(() => initial, { set() {}, update() {} })
}));

const { DoomTextureService } = await import('../doom-texture.service');
const { TextureMappingService } = await import('./texture-mapping.service');

function createMappingService() {
    const fixture = createSharedTexelReferenceFixture();
    const service = Object.create(TextureMappingService.prototype) as TextureMappingServiceType;
    Object.assign(service, fixture, {
        groupToTextureMap: new Map(),
        textureLocations: []
    });
    (service as unknown as { precomputeTextureLocations(): void }).precomputeTextureLocations();
    return { fixture, service };
}

describe('texture references', () => {
    test('share only the physical texel buffer', () => {
        const { service } = createMappingService();
        const parent = service.getTextureById(0)!;
        const reference = service.getTextureById(1)!;

        expect(reference.fileIndex).toBe(parent.fileIndex);
        expect(reference.fileOffset).toBe(parent.fileOffset);
        expect(reference.dataLength).toBe(parent.dataLength);
        expect([reference.width, reference.height]).toEqual([8, 4]);
        expect(reference.bounds).toEqual({ minX: 2, maxX: 4, minY: 0, maxY: 2 });
        expect(parent.bounds).toEqual({ minX: 0, maxX: 2, minY: 0, maxY: 2 });
    });

    test('resolves chains and rejects cycles and out-of-range parents', () => {
        const { service } = createMappingService();
        service.mediaDimensions![2] = 0x22;
        service.mediaDimensions![3] = 0x22;
        service.mediaDimensions![4] = 0x22;
        service.mediaDimensions![5] = 0x22;
        service.mediaTexelSizes![2] = 0x8001; // 2 -> 1 -> 0
        service.mediaTexelSizes![3] = 0x8004; // cycle
        service.mediaTexelSizes![4] = 0x8003;
        service.mediaTexelSizes![5] = 0x8400; // parent 1024
        (service as unknown as { precomputeTextureLocations(): void }).precomputeTextureLocations();

        expect(service.getTextureById(2)!.fileOffset).toBe(service.getTextureById(0)!.fileOffset);
        expect(service.getTextureById(2)!.valid).toBe(true);
        for (const id of [3, 4, 5]) {
            expect(service.getTextureById(id)).toMatchObject({ valid: false, fileIndex: -1 });
        }
    });

    test('reads parent bytes while decompressing with reference geometry', () => {
        const { fixture, service: mappingService } = createMappingService();
        const textureService = Object.create(DoomTextureService.prototype) as DoomTextureServiceType;
        Object.assign(textureService, {
            mappingService,
            fileService: { getFile: () => fixture.compressed.buffer }
        });

        expect(textureService.isTextureCompressed(0)).toBe(true);
        expect(textureService.isTextureCompressed(1)).toBe(true);
        const parent = textureService.getTextureRawIndices(0)!;
        const reference = textureService.getTextureRawIndices(1)!;
        expect(parent.length).toBe(4 * 4);
        expect(reference.length).toBe(8 * 4);
        expect(Array.from(parent.slice(0, 2))).toEqual([7, 8]);
        expect(Array.from(reference.slice(2, 4))).toEqual([7, 8]);
        expect(Array.from(reference.slice(0, 2))).toEqual([0, 0]);
    });
});
