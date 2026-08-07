import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomTextureService } from '../doom-texture.service.ts';
import { TextureMappingService } from './texture-mapping.service.ts';
import { createSharedTexelReferenceFixture } from './texture-reference.fixture.ts';

function createMappingService() {
    const fixture = createSharedTexelReferenceFixture();
    const service = Object.create(TextureMappingService.prototype) as TextureMappingService;
    Object.assign(service, fixture, { groupToTextureMap: new Map(), textureLocations: [] });
    (service as unknown as { precomputeTextureLocations(): void }).precomputeTextureLocations();
    return { fixture, service };
}

test('texture references share bytes but keep their own geometry', () => {
    const { fixture, service: mappingService } = createMappingService();
    const parent = mappingService.getTextureById(0)!;
    const reference = mappingService.getTextureById(1)!;
    assert.deepEqual(
        [reference.fileIndex, reference.fileOffset, reference.dataLength],
        [parent.fileIndex, parent.fileOffset, parent.dataLength]
    );
    assert.deepEqual([reference.width, reference.height], [8, 4]);
    assert.notDeepEqual(reference.bounds, parent.bounds);

    const textureService = Object.create(DoomTextureService.prototype) as DoomTextureService;
    Object.assign(textureService, {
        mappingService,
        fileService: { getFile: () => fixture.compressed.buffer }
    });
    const parsed = textureService.getTextureRawIndices(1)!;
    assert.equal(parsed.length, 8 * 4);
    assert.deepEqual(Array.from(parsed.slice(2, 4)), [7, 8]);
});

test('reference chains resolve while cycles and invalid parents are rejected', () => {
    const { service } = createMappingService();
    service.mediaDimensions![2] = service.mediaDimensions![3] = service.mediaDimensions![4] = 0x22;
    service.mediaTexelSizes![2] = 0x8001;
    service.mediaTexelSizes![3] = 0x8004;
    service.mediaTexelSizes![4] = 0x8003;
    (service as unknown as { precomputeTextureLocations(): void }).precomputeTextureLocations();
    assert.equal(service.getTextureById(2)!.fileOffset, service.getTextureById(0)!.fileOffset);
    assert.equal(service.getTextureById(2)!.valid, true);
    assert.equal(service.getTextureById(3)!.valid, false);
    assert.equal(service.getTextureById(4)!.valid, false);
});

test('texture rebuilding follows the engine 32768-byte rollover and omits references', () => {
    const saved = new Map<string, Uint8Array>();
    const service = Object.create(DoomTextureService.prototype) as DoomTextureService;
    Object.assign(service, { fileService: { saveBuffer: (name: string, data: ArrayBuffer) => saved.set(name, new Uint8Array(data)) } });
    const fixture: (Uint8Array | null)[] = [
        new Uint8Array(32768).fill(1),
        null, // reference resources have no independent texels
        new Uint8Array([2]),
        new Uint8Array([3, 3])
    ];
    (service as unknown as { rebuildAllTextureFilesFromSnapshot(data: (Uint8Array | null)[]): void })
        .rebuildAllTextureFilesFromSnapshot(fixture);
    assert.equal(saved.get('tex00.bin')!.length, 32769);
    assert.deepEqual(Array.from(saved.get('tex00.bin')!.slice(-1)), [2]);
    assert.deepEqual(Array.from(saved.get('tex01.bin')!), [3, 3]);
});
