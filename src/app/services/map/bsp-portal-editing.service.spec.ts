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

test('Y-oriented wall preserves a reversed collision-line direction', () => {
    const { service, geometryService, geometry } = passageFixture();
    Object.assign(geometry.sourceVertices[0], { x: 10, y: 2 });
    Object.assign(geometry.sourceVertices[1], { x: 10, y: 20 });
    Object.assign(geometry.lines[0], { x1: 10, y1: 20, x2: 10, y2: 2 });
    geometryService.rebuildRenderData(geometry);
    service.createPassage(geometry, { wallPolygonIndex: 0, start: 8, end: 14, bottom: 0, top: 8 });
    assert.deepEqual(geometry.lines, [
        { flags: 3, x1: 10, y1: 8, x2: 10, y2: 2 },
        { flags: 3, x1: 10, y1: 20, x2: 10, y2: 14 }
    ]);
});

test('passage starts at the signed height-map floor and enforces player clearance', () => {
    const { service, geometryService, geometry } = passageFixture();
    geometry.heightMap.fill(2);
    geometry.sourceVertices[0].z = 2;
    geometry.sourceVertices[1].z = 14;
    const before = geometryService.cloneEditable(geometry);
    assert.throws(() => service.createPassage(geometry, { wallPolygonIndex: 0, start: 8, end: 14, bottom: 2, top: 8 }), /at least 7/);
    assert.deepEqual(geometry, before, 'clearance failure rolls back every field');
    service.createPassage(geometry, { wallPolygonIndex: 0, start: 8, end: 14, bottom: 2, top: 9 });
});

test('hanging and floor-mismatched openings are rejected before mutation', () => {
    const { service, geometryService, geometry } = passageFixture();
    for (const request of [
        { wallPolygonIndex: 0, start: 8, end: 14, bottom: 1, top: 8 },
        { wallPolygonIndex: 0, start: 8, end: 14, bottom: 2, top: 9 }
    ]) {
        const before = geometryService.cloneEditable(geometry);
        assert.throws(() => service.createPassage(geometry, request), /hanging|floor/);
        assert.deepEqual(geometry, before);
    }
});

test('packed lineCount overflow is detected by preview and leaves geometry untouched', () => {
    const { service, geometryService, geometry } = passageFixture();
    geometry.leaves[0].lineCount = 63;
    geometry.lines.push(...Array.from({ length: 62 }, () => ({ ...geometry.lines[0] })));
    geometry.nodes[0].child2 = (63 << 10);
    const before = geometryService.cloneEditable(geometry);
    assert.throws(() => service.createPassage(geometry, { wallPolygonIndex: 0, start: 8, end: 14, bottom: 0, top: 8 }), /exactly one|lineCount/);
    assert.deepEqual(geometry, before);
});
