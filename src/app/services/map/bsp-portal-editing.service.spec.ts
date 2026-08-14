import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomGeometryService } from '../doom-geometry.service.ts';
import { BspPortalEditingService } from './bsp-portal-editing.service.ts';

function passageFixture() {
    const geometryService = new DoomGeometryService();
    const geometry = geometryService.processGeometry(
        new Int16Array(), new Uint16Array([0xffff]), new Uint8Array([0]),
        new Uint16Array([1 << 9]), new Uint16Array([1 << 10]), new Uint8Array([0, 30]), new Uint8Array([0, 30]),
        new Uint16Array([0]), new Uint16Array([0]), new Uint8Array([1]), new Uint8Array([0]),
        new Uint8Array([2, 20]), new Uint8Array([10, 10]), new Uint8Array([0, 12]),
        new Int8Array([0, 18]), new Int8Array([0, 12]),
        new Uint8Array([3]), new Uint8Array([2, 20]), new Uint8Array([10, 10]), new Int8Array(1024)
    );
    const service = Object.create(BspPortalEditingService.prototype) as BspPortalEditingService;
    Object.assign(service, { geometryService });
    return { service, geometryService, geometry };
}

test('passage transaction splits its wall collision line and keeps packed leaf ranges synchronized', () => {
    const { service, geometryService, geometry } = passageFixture();
    const result = service.createPassage(geometry, { wallPolygonIndex: 0, start: 8, end: 14, bottom: 0, top: 8 });
    assert.equal(result.preview.requiresBspRebuild, false);
    assert.deepEqual(geometry.lines, [
        { flags: 3, x1: 2, y1: 10, x2: 8, y2: 10 },
        { flags: 3, x1: 14, y1: 10, x2: 20, y2: 10 }
    ]);
    assert.equal(geometry.leaves[0].lineCount, 2);
    assert.equal(geometry.nodes[0].child2, 2 << 10);
    assert.deepEqual(geometryService.validate(geometry), []);
});

test('failed passage restores the complete original geometry snapshot', () => {
    const { service, geometryService, geometry } = passageFixture();
    const before = geometryService.cloneEditable(geometry);
    assert.throws(() => service.createPassage(geometry, { wallPolygonIndex: 0, start: 0, end: 14, bottom: 0, top: 8 }), /strictly inside/);
    assert.deepEqual(geometry, before);
});

