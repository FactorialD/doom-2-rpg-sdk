import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { PolyFlag } from '../../core/constants/geometry';
import { DoomGeometryService, MapGeometry } from '../doom-geometry.service';
import { resolveDraftPoint, validateDraftLeaf, wallAxisFromEndpoints } from './map-drawing';

function vector(x = 0, y = 0, z = 0): THREE.Vector3 {
    return { x, y, z, clone: () => vector(x, y, z) } as THREE.Vector3;
}

function geometryWithTwoLeaves(): MapGeometry {
    return {
        normals: [],
        nodes: [
            { offset: 0xffff, normalIndex: 0, child1: 0, child2: 0, minX: 0, maxX: 10, minY: 0, maxY: 10 },
            { offset: 0xffff, normalIndex: 0, child1: 1, child2: 0, minX: 11, maxX: 20, minY: 0, maxY: 10 }
        ],
        leaves: [
            { vertexOffset: 0, polygonOffset: 0, polygonCount: 0, nodeIndex: 0 },
            { vertexOffset: 0, polygonOffset: 0, polygonCount: 0, nodeIndex: 1 }
        ],
        polygons: [], sourceVertices: [], lines: [], heightMap: new Int8Array(1024),
        vertices: new Float32Array(), uvs: new Float32Array(), indices: [], textureIds: [], flags: [], polyVertexCounts: []
    };
}

describe('map drawing helpers', () => {
    it('uses the working-plane hit when a click has no geometry hit', () => {
        const planeHit = vector(128, 0, 256);
        const point = resolveDraftPoint(null, planeHit, null)!;
        assert.deepEqual([point.x, point.y, point.z], [128, 0, 256]);
    });

    it('derives each wall axis from its two endpoints', () => {
        const origin = new THREE.Vector3();
        assert.equal(wallAxisFromEndpoints(origin, new THREE.Vector3(256, 0, 0)), PolyFlag.AxisX);
        assert.equal(wallAxisFromEndpoints(origin, new THREE.Vector3(0, 0, 256)), PolyFlag.AxisY);
        assert.equal(wallAxisFromEndpoints(origin, new THREE.Vector3(0, 256, 0)), PolyFlag.AxisZ);
    });

    it('projects subsequent polygon points onto the fixed plane', () => {
        const plane = {
            projectPoint(point: THREE.Vector3, target: THREE.Vector3) { target.x = point.x; target.y = 128; target.z = point.z; return target; },
            distanceToPoint(point: THREE.Vector3) { return point.y - 128; }
        } as THREE.Plane;
        const point = resolveDraftPoint(new THREE.Vector3(256, 999, 384), null, plane)!;
        assert.equal(plane.distanceToPoint(point), 0);
        assert.deepEqual([point.x, point.y, point.z], [256, 128, 384]);
    });

    it('rejects an empty-area start and crossing into another BSP leaf', () => {
        const service = new DoomGeometryService();
        const geometry = geometryWithTwoLeaves();
        assert.match(validateDraftLeaf(service, geometry, new THREE.Vector3(30 * 128, 0, 5 * 128), null).message!, /outside every valid BSP leaf/);
        assert.match(validateDraftLeaf(service, geometry, new THREE.Vector3(15 * 128, 0, 5 * 128), 0).message!, /another BSP leaf/);
    });
});
