import assert from 'node:assert/strict';
import test from 'node:test';
import { MapSerializer } from './map-serializer.ts';
import { ScriptCompilerService } from '../scripts/script-compiler.service.ts';
import { MAP_FIRST_MARKER, MAP_MARKER } from '../../utils/byte-stream.ts';
import type { MapData } from '../doom-map.service.ts';
import { DoomGeometryService } from '../doom-geometry.service.ts';
import { PolyFlag } from '../../core/constants/geometry.ts';

function syntheticEmptyMap(): Uint8Array {
    const bytes = new Uint8Array(46 + 6 + 4 * 16 + 1024 + 24 + 8);
    const view = new DataView(bytes.buffer);
    // The 46-byte header is intentionally non-zero outside count fields.
    bytes.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    let position = 46;
    const marker = (value: number) => { view.setInt32(position, value, true); position += 4; };
    marker(MAP_FIRST_MARKER); view.setUint16(position, 0, true); position += 2;
    marker(MAP_FIRST_MARKER);
    for (let i = 0; i < 8; i++) marker(MAP_MARKER);
    position += 1024; // untouched height map
    for (let i = 0; i < 4; i++) marker(MAP_MARKER);
    marker(MAP_MARKER); position += 24; // static function table
    marker(MAP_MARKER); // empty tile events
    marker(MAP_MARKER); // empty bytecode
    bytes.set([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4], position); // cameras/unknown remainder
    return bytes;
}

test('synthetic map parse/serialize shape preserves every untouched section and remainder', () => {
    const original = syntheticEmptyMap();
    const serializer = Object.create(MapSerializer.prototype) as MapSerializer;
    Object.assign(serializer, {
        coordinateService: { analyzeSpriteType: () => ({ type: 'normal', fileZ: 0 }) },
        scriptService: {},
        scriptCompiler: {}
    });
    const map = {
        header: { spawnIndex: 0, spawnDir: 0, numPolys: 0, numVerts: 0, numSprites: 0 },
        geometry: {
            normals: [], nodes: [], leaves: [], polygons: [], sourceVertices: [], lines: [], heightMap: new Int8Array(1024),
            vertices: new Float32Array(), uvs: new Float32Array(), indices: [], textureIds: [], flags: [], polyVertexCounts: []
        },
        sprites: [],
        bspTree: { id: 0, isLeaf: true, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
        heightMap: new Int8Array(1024),
        remainderOffset: original.length - 8
    } as unknown as MapData;

    const serialized = serializer.serialize(map, original.buffer, 'synthetic-map.bin');
    assert.deepEqual(serialized, original);
    // A second parse/serialize-shaped pass must remain byte exact as well.
    assert.deepEqual(serializer.serialize(map, serialized.buffer, 'synthetic-map-2.bin'), original);
});

test('wall add and delete update leaf indices and round trip back without touching unrelated state', () => {
    const service = new DoomGeometryService();
    const geometry = service.processGeometry(
        new Int16Array(), new Uint16Array([0xffff]), new Uint8Array([0]),
        new Uint16Array([0]), new Uint16Array([0]), new Uint8Array([0, 255]), new Uint8Array([0, 255]),
        new Uint16Array([0]), new Uint16Array([0]), new Uint8Array(), new Uint8Array(),
        new Uint8Array(), new Uint8Array(), new Uint8Array(), new Int8Array(), new Int8Array(),
        new Uint8Array(), new Uint8Array(), new Uint8Array(), new Int8Array(1024)
    );
    const unrelated = { sprites: [{ uuid: 'sprite' }], scripts: new Uint8Array([1, 2, 3]), tail: new Uint8Array([0xde, 0xad]) };
    const before = structuredClone(unrelated);

    const index = service.addPolygon(geometry, {
        leafIndex: 0, textureId: 300, flags: PolyFlag.AxisZ | PolyFlag.WallTexture,
        vertices: [{ x: 4, y: 5, z: 2, u: 0, v: 0 }, { x: 8, y: 5, z: 10, u: 8, v: 8 }]
    });
    assert.equal(index, 0);
    assert.equal(geometry.nodes[0].child1, (1 << 9) | 0);
    assert.deepEqual(geometry.polygons[0], { textureId: 300, flags: PolyFlag.AxisZ | PolyFlag.WallTexture, vertexStart: 0, vertexCount: 2, leafIndex: 0 });
    assert.deepEqual(service.validate(geometry), []);

    service.removePolygon(geometry, 0);
    assert.equal(geometry.nodes[0].child1, 0);
    assert.equal(geometry.polygons.length, 0);
    assert.equal(geometry.sourceVertices.length, 0);
    assert.deepEqual(unrelated, before);
});

test('map scripts round trip multiple events on a tile after flag edits and deletion', () => {
    const original = syntheticEmptyMap();
    const serializer = Object.create(MapSerializer.prototype) as MapSerializer;
    Object.assign(serializer, {
        coordinateService: { analyzeSpriteType: () => ({ type: 'normal', fileZ: 0 }) },
        scriptService: { updateScriptIndices: () => true },
        scriptCompiler: new ScriptCompilerService()
    });
    const handler = { uid: 'handler', opcode: 2, params: [], offset: 0, size: 1 } as any;
    const map = {
        header: { spawnIndex: 0, spawnDir: 0, numPolys: 0, numVerts: 0, numSprites: 0 },
        geometry: {
            normals: [], nodes: [], leaves: [], polygons: [], sourceVertices: [], lines: [], heightMap: new Int8Array(1024),
            vertices: new Float32Array(), uvs: new Float32Array(), indices: [], textureIds: [], flags: [], polyVertexCounts: []
        }, sprites: [],
        bspTree: { id: 0, isLeaf: true, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
        heightMap: new Int8Array(1024), remainderOffset: original.length - 8,
        scripts: {
            mapId: 1, instructions: [handler], staticFuncs: {}, staticFuncOffsets: [], rawSize: 1,
            tileEvents: new Int32Array(), tileEventRefs: [
                { uid: 'enter', tileIndex: 42, targetUid: 'handler', flags: 0xff1 },
                { uid: 'use', tileIndex: 42, targetUid: 'handler', flags: 0xff4 }
            ]
        }
    } as unknown as MapData;

    const first = serializer.serialize(map, original.buffer, 'events-1.bin');
    assert.equal(new DataView(first.buffer, first.byteOffset).getInt16(27, true), 2);

    map.scripts!.tileEventRefs[0].flags = 0xff2;
    map.scripts!.tileEventRefs.splice(1, 1);
    const second = serializer.serialize(map, first.buffer, 'events-2.bin');
    const view = new DataView(second.buffer, second.byteOffset, second.byteLength);
    assert.equal(view.getInt16(27, true), 1);
    // The sole event is immediately before the bytecode marker, bytecode, and 8-byte remainder.
    const eventFlagsOffset = second.byteLength - 8 - 1 - 4 - 4;
    assert.equal(view.getInt32(eventFlagsOffset, true), 0xff2);
});
