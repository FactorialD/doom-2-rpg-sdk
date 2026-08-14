import assert from 'node:assert/strict';
import test from 'node:test';
import { DoomGeometryService, MapGeometry } from './doom-geometry.service.ts';

function editablePolygon(): MapGeometry {
    const service = new DoomGeometryService();
    return service.processGeometry(
        new Int16Array(), new Uint16Array([0xffff]), new Uint8Array([0]),
        new Uint16Array([1 << 9]), new Uint16Array([0]), new Uint8Array([0, 10]), new Uint8Array([0, 10]),
        new Uint16Array([0]), new Uint16Array([0]), new Uint8Array([1]), new Uint8Array([1]),
        new Uint8Array([1, 5, 5]), new Uint8Array([1, 1, 5]), new Uint8Array([2, 2, 2]),
        new Int8Array(3), new Int8Array(3), new Uint8Array(), new Uint8Array(), new Uint8Array(), new Int8Array(1024)
    );
}

test('vertex coordinate edit survives render-data rebuild and clone round trip', () => {
    const service = new DoomGeometryService();
    const geometry = editablePolygon();
    const before = service.cloneEditable(geometry);

    assert.equal(service.moveVertex(geometry, { polyIndex: 0, vertexIndex: 1, vertex: { x: 6, y: 1, z: 2 } }), null);
    assert.deepEqual(geometry.sourceVertices[1], { x: 6, y: 1, z: 2, u: 0, v: 0 });
    assert.equal(geometry.vertices[3], 6 * 128);
    assert.deepEqual(service.cloneEditable(geometry).sourceVertices, geometry.sourceVertices);

    const bytes = geometry.sourceVertices;
    const reparsed = service.processGeometry(
        new Int16Array(), new Uint16Array([0xffff]), new Uint8Array([0]),
        new Uint16Array([1 << 9]), new Uint16Array([0]), new Uint8Array([0, 10]), new Uint8Array([0, 10]),
        new Uint16Array([0]), new Uint16Array([0]), new Uint8Array([1]), new Uint8Array([1]),
        Uint8Array.from(bytes, v => v.x), Uint8Array.from(bytes, v => v.y), Uint8Array.from(bytes, v => v.z),
        Int8Array.from(bytes, v => v.u), Int8Array.from(bytes, v => v.v),
        new Uint8Array(), new Uint8Array(), new Uint8Array(), new Int8Array(1024)
    );
    assert.deepEqual(reparsed.sourceVertices, geometry.sourceVertices);

    const redo = service.cloneEditable(geometry);
    const undone = service.cloneEditable(before);
    assert.deepEqual(undone.sourceVertices[1], { x: 5, y: 1, z: 2, u: 0, v: 0 });
    assert.deepEqual(service.cloneEditable(redo).sourceVertices[1], geometry.sourceVertices[1]);
});

test('vertex edits reject uint8 overflow, BSP-leaf escape, non-coplanarity, and degeneracy', () => {
    const service = new DoomGeometryService();
    const geometry = editablePolygon();
    const original = structuredClone(geometry.sourceVertices);

    assert.match(service.moveVertex(geometry, { polyIndex: 0, vertexIndex: 0, vertex: { x: 256, y: 1, z: 2 } })!, /uint8/);
    assert.match(service.moveVertex(geometry, { polyIndex: 0, vertexIndex: 0, vertex: { x: 11, y: 1, z: 2 } })!, /BSP leaf/);
    assert.match(service.moveVertex(geometry, { polyIndex: 0, vertexIndex: 0, vertex: { x: 1, y: 1, z: 3 } })!, /coplanar/);
    assert.match(service.moveVertex(geometry, { polyIndex: 0, vertexIndex: 2, vertex: { x: 9, y: 1, z: 2 } })!, /degenerate/);
    assert.deepEqual(geometry.sourceVertices, original);
});

test('unpacks collision ranges and follows Render.nodeClassifyPoint instead of overlapping bounds', () => {
    const service = new DoomGeometryService();
    const geometry = service.processGeometry(
        new Int16Array([-16384, 0, 0]), new Uint16Array([10 * 128, 0xffff, 0xffff]), new Uint8Array([0, 0, 0]),
        new Uint16Array([1, 0, 1]), new Uint16Array([2, (1 << 10), (1 << 10) | 1]),
        new Uint8Array([0, 20, 0, 20, 0, 20]), new Uint8Array([0, 20, 0, 20, 0, 20]),
        new Uint16Array([0, 0]), new Uint16Array([0, 0]), new Uint8Array(), new Uint8Array(),
        new Uint8Array(), new Uint8Array(), new Uint8Array(), new Int8Array(), new Int8Array(),
        new Uint8Array([0x21]), new Uint8Array([0, 10, 10, 20]), new Uint8Array([5, 5, 5, 5]), new Int8Array(1024)
    );
    assert.deepEqual(geometry.leaves.map(({ lineOffset, lineCount }) => ({ lineOffset, lineCount })), [
        { lineOffset: 0, lineCount: 1 }, { lineOffset: 1, lineCount: 1 }
    ]);
    assert.equal(service.classifyPoint(geometry, 0, 5, 5), 640);
    assert.equal(service.findLeafAt(geometry, 5, 5), 0);
    assert.equal(service.findLeafAt(geometry, 15, 5), 1);
});

test('line replacement atomically updates following leaf offsets and packed child2', () => {
    const service = new DoomGeometryService();
    const geometry = service.processGeometry(
        new Int16Array(), new Uint16Array([0xffff, 0xffff]), new Uint8Array([0, 0]),
        new Uint16Array([0, 1]), new Uint16Array([(1 << 10), (1 << 10) | 1]),
        new Uint8Array([0, 10, 11, 20]), new Uint8Array([0, 10, 0, 10]),
        new Uint16Array([0, 0]), new Uint16Array([0, 0]), new Uint8Array(), new Uint8Array(),
        new Uint8Array(), new Uint8Array(), new Uint8Array(), new Int8Array(), new Int8Array(),
        new Uint8Array([0x11]), new Uint8Array([0, 10, 11, 20]), new Uint8Array([0, 0, 0, 0]), new Int8Array(1024)
    );
    // The disconnected two-root fixture is sufficient for range mutation; validation is bypassed while applying the primitive.
    (service as any).assertValid = () => undefined;
    service.replaceLines(geometry, 0, 0, 1, [
        { flags: 1, x1: 0, y1: 0, x2: 4, y2: 0 }, { flags: 1, x1: 6, y1: 0, x2: 10, y2: 0 }
    ]);
    assert.equal(geometry.leaves[1].lineOffset, 2);
    assert.equal(geometry.nodes[0].child2, (2 << 10));
    assert.equal(geometry.nodes[1].child2, (1 << 10) | 2);
});
