import { Injectable } from '@angular/core';
import { GeometryScale, PolyFlag } from '../core/constants/geometry';
import { SpecialTextureIds } from '../core/constants/texture-groups';

/** Signed 2.14 fixed-point BSP plane normal, as stored by Render.java. */
export interface MapNormal { x: number; y: number; z: number; }
export interface MapNodeRecord {
    offset: number; normalIndex: number; child1: number; child2: number;
    minX: number; maxX: number; minY: number; maxY: number;
}
export interface MapLeafRecord { vertexOffset: number; polygonOffset: number; polygonCount: number; nodeIndex: number; }
export interface MapVertexRecord { x: number; y: number; z: number; u: number; v: number; }
export interface MapPolygonRecord { textureId: number; flags: number; vertexStart: number; vertexCount: number; leafIndex: number; }
export interface MapLineRecord { flags: number; x1: number; y1: number; x2: number; y2: number; }

/** Editable lossless map geometry plus derived Three.js render buffers. */
export interface MapGeometry {
    normals: MapNormal[];
    nodes: MapNodeRecord[];
    leaves: MapLeafRecord[];
    polygons: MapPolygonRecord[];
    sourceVertices: MapVertexRecord[];
    lines: MapLineRecord[];
    heightMap: Int8Array;
    vertices: Float32Array;
    uvs: Float32Array;
    indices: number[];
    textureIds: number[];
    flags: number[];
    polyVertexCounts: number[];
}

export interface GeometryValidationIssue { section: string; index: number; message: string; }
export interface NewPolygon { leafIndex: number; textureId: number; flags: number; vertices: MapVertexRecord[]; }
export interface GeometryVertexMove { polyIndex: number; vertexIndex: number; vertex: Pick<MapVertexRecord, 'x' | 'y' | 'z'>; }

@Injectable({ providedIn: 'root' })
export class DoomGeometryService {
    processGeometry(
        normals: Int16Array, nodeOffsets: Uint16Array, nodeNormalIdxs: Uint8Array,
        nodeChildOffset1: Uint16Array, nodeChildOffset2: Uint16Array,
        nodeBoundXs: Uint8Array, nodeBoundYs: Uint8Array,
        nodePolyOffset: Uint16Array, nodeVertOffset: Uint16Array,
        polyTex: Uint8Array, polyFlags: Uint8Array,
        polyXs: Uint8Array, polyYs: Uint8Array, polyZs: Uint8Array, polyUs: Int8Array, polyVs: Int8Array,
        lineFlags: Uint8Array, lineXs: Uint8Array, lineYs: Uint8Array, heightMap: Int8Array
    ): MapGeometry {
        const normalRecords = Array.from({ length: normals.length / 3 }, (_, i) => ({ x: normals[i * 3], y: normals[i * 3 + 1], z: normals[i * 3 + 2] }));
        const nodes = Array.from(nodeOffsets, (offset, i) => ({
            offset, normalIndex: nodeNormalIdxs[i], child1: nodeChildOffset1[i], child2: nodeChildOffset2[i],
            minX: nodeBoundXs[i * 2], maxX: nodeBoundXs[i * 2 + 1], minY: nodeBoundYs[i * 2], maxY: nodeBoundYs[i * 2 + 1]
        }));
        const leafNodeByIndex = new Map<number, number>();
        nodes.forEach((node, nodeIndex) => { if (node.offset === 0xffff) leafNodeByIndex.set(node.child1 & 0x1ff, nodeIndex); });
        const leaves = Array.from(nodePolyOffset, (polygonOffset, i) => ({
            polygonOffset, vertexOffset: nodeVertOffset[i], polygonCount: nodes[leafNodeByIndex.get(i) ?? -1]?.child1 >> 9 & 0x7f,
            nodeIndex: leafNodeByIndex.get(i) ?? -1
        }));
        const sourceVertices = Array.from(polyXs, (x, i) => ({ x, y: polyYs[i], z: polyZs[i], u: polyUs[i], v: polyVs[i] }));
        const polygons: MapPolygonRecord[] = [];
        leaves.forEach((leaf, leafIndex) => {
            let vertexStart = leaf.vertexOffset;
            for (let p = leaf.polygonOffset; p < leaf.polygonOffset + leaf.polygonCount && p < polyTex.length; p++) {
                const flags = polyFlags[p];
                const vertexCount = (flags & 7) + 2;
                const textureId = polyTex[p] + ((flags & PolyFlag.WallTexture) ? SpecialTextureIds.WALL_OFFSET : 0);
                polygons[p] = { textureId, flags, vertexStart, vertexCount, leafIndex };
                vertexStart += vertexCount;
            }
        });
        // Preserve malformed/unreferenced records so validation can report rather than silently discard them.
        for (let p = 0; p < polyTex.length; p++) if (!polygons[p]) {
            polygons[p] = { textureId: polyTex[p] + ((polyFlags[p] & PolyFlag.WallTexture) ? SpecialTextureIds.WALL_OFFSET : 0), flags: polyFlags[p], vertexStart: 0, vertexCount: (polyFlags[p] & 7) + 2, leafIndex: -1 };
        }
        const lines = Array.from({ length: lineXs.length / 2 }, (_, i) => ({
            flags: (lineFlags[i >> 1] >> ((i & 1) * 4)) & 0xf,
            x1: lineXs[i * 2], y1: lineYs[i * 2], x2: lineXs[i * 2 + 1], y2: lineYs[i * 2 + 1]
        }));
        const geometry = { normals: normalRecords, nodes, leaves, polygons, sourceVertices, lines, heightMap: heightMap.slice(),
            vertices: new Float32Array(), uvs: new Float32Array(), indices: [], textureIds: [], flags: [], polyVertexCounts: [] };
        this.rebuildRenderData(geometry);
        return geometry;
    }

    rebuildRenderData(geometry: MapGeometry): void {
        const verts: number[] = [], uvs: number[] = [], indices: number[] = [];
        const textureIds: number[] = [], flagsList: number[] = [], counts: number[] = [];
        let outputIndex = 0;
        geometry.polygons.forEach(poly => {
            const raw = geometry.sourceVertices.slice(poly.vertexStart, poly.vertexStart + poly.vertexCount);
            if (poly.vertexCount === 2 && raw.length === 2) {
                const [p0, p1] = raw; const q0 = { ...p0 }, q1 = { ...p0 }, q2 = { ...p1 }, q3 = { ...p1 };
                switch (poly.flags & PolyFlag.AxisMask) {
                    case PolyFlag.AxisX: q1.x = q2.x; q3.x = q0.x; break;
                    case PolyFlag.AxisY: q1.y = q2.y; q3.y = q0.y; break;
                    default: q1.z = q2.z; q3.z = q0.z;
                }
                if (poly.flags & PolyFlag.UVDeltaX) { q1.u = q2.u; q3.u = q0.u; }
                else { q1.v = q2.v; q3.v = q0.v; }
                [q0, q1, q2, q3].forEach(v => this.pushVert(verts, uvs, v, false));
                indices.push(outputIndex, outputIndex + 1, outputIndex + 2, outputIndex, outputIndex + 2, outputIndex + 3);
                outputIndex += 4; counts.push(4);
            } else {
                raw.forEach(v => this.pushVert(verts, uvs, v, !!(poly.flags & PolyFlag.SwapXY)));
                for (let v = 2; v < raw.length; v++) indices.push(outputIndex, outputIndex + v - 1, outputIndex + v);
                outputIndex += raw.length; counts.push(raw.length);
            }
            textureIds.push(poly.textureId); flagsList.push(poly.flags);
        });
        geometry.vertices = new Float32Array(verts); geometry.uvs = new Float32Array(uvs); geometry.indices = indices;
        geometry.textureIds = textureIds; geometry.flags = flagsList; geometry.polyVertexCounts = counts;
    }

    /** Validates and applies one source-vertex edit without changing its UV coordinates. */
    moveVertex(geometry: MapGeometry, move: GeometryVertexMove): string | null {
        const poly = geometry.polygons[move.polyIndex];
        if (!poly || move.vertexIndex < 0 || move.vertexIndex >= poly.vertexCount) return 'The selected polygon vertex no longer exists.';
        const next = move.vertex;
        if (![next.x, next.y, next.z].every(value => Number.isInteger(value) && value >= 0 && value <= 0xff)) {
            return 'Vertex coordinates must be integers in the uint8 range (0…255).';
        }
        const leaf = geometry.leaves[poly.leafIndex];
        const leafNode = leaf && geometry.nodes[leaf.nodeIndex];
        if (!leafNode || next.x < leafNode.minX || next.x > leafNode.maxX || next.y < leafNode.minY || next.y > leafNode.maxY) {
            return 'The vertex must remain in the polygon’s BSP leaf.';
        }

        const vertices = geometry.sourceVertices.slice(poly.vertexStart, poly.vertexStart + poly.vertexCount).map(vertex => ({ ...vertex }));
        vertices[move.vertexIndex] = { ...vertices[move.vertexIndex], ...next };
        if (poly.vertexCount === 2) {
            const [a, b] = vertices;
            if (a.x === b.x && a.y === b.y && a.z === b.z) return 'Wall endpoints cannot occupy the same position.';
        } else {
            const normal = this.newellNormal(vertices);
            if (normal.x === 0 && normal.y === 0 && normal.z === 0) return 'The polygon cannot be degenerate.';
            const original = geometry.sourceVertices.slice(poly.vertexStart, poly.vertexStart + poly.vertexCount);
            const originalNormal = this.newellNormal(original);
            const origin = original[0];
            if (originalNormal.x || originalNormal.y || originalNormal.z) {
                const distance = originalNormal.x * (next.x - origin.x) + originalNormal.y * (next.y - origin.y) + originalNormal.z * (next.z - origin.z);
                if (distance !== 0) return 'The moved vertex must remain coplanar with the polygon.';
            }
        }

        Object.assign(geometry.sourceVertices[poly.vertexStart + move.vertexIndex], next);
        this.rebuildRenderData(geometry);
        return null;
    }

    addPolygon(geometry: MapGeometry, input: NewPolygon): number {
        const leaf = geometry.leaves[input.leafIndex];
        if (!leaf) throw new Error(`Leaf ${input.leafIndex} does not exist`);
        const flags = (input.flags & 0xf8) | (input.vertices.length - 2);
        const record: MapPolygonRecord = { textureId: input.textureId, flags, vertexStart: 0, vertexCount: input.vertices.length, leafIndex: input.leafIndex };
        const insertPoly = leaf.polygonOffset + leaf.polygonCount;
        const insertVert = leaf.vertexOffset + geometry.polygons.slice(leaf.polygonOffset, insertPoly).reduce((n, p) => n + p.vertexCount, 0);
        record.vertexStart = insertVert;
        geometry.polygons.splice(insertPoly, 0, record); geometry.sourceVertices.splice(insertVert, 0, ...input.vertices.map(v => ({ ...v })));
        leaf.polygonCount++;
        for (let i = input.leafIndex + 1; i < geometry.leaves.length; i++) { geometry.leaves[i].polygonOffset++; geometry.leaves[i].vertexOffset += input.vertices.length; }
        this.syncLeafNodes(geometry); this.reindexPolygons(geometry); this.assertValid(geometry); this.rebuildRenderData(geometry);
        return insertPoly;
    }

    removePolygon(geometry: MapGeometry, polygonIndex: number): MapPolygonRecord {
        const poly = geometry.polygons[polygonIndex];
        if (!poly || poly.leafIndex < 0) throw new Error(`Polygon ${polygonIndex} is not owned by a BSP leaf`);
        geometry.polygons.splice(polygonIndex, 1); geometry.sourceVertices.splice(poly.vertexStart, poly.vertexCount);
        geometry.leaves[poly.leafIndex].polygonCount--;
        for (let i = poly.leafIndex + 1; i < geometry.leaves.length; i++) { geometry.leaves[i].polygonOffset--; geometry.leaves[i].vertexOffset -= poly.vertexCount; }
        this.syncLeafNodes(geometry); this.reindexPolygons(geometry); this.assertValid(geometry); this.rebuildRenderData(geometry);
        return poly;
    }

    validate(geometry: MapGeometry): GeometryValidationIssue[] {
        const issues: GeometryValidationIssue[] = [];
        const issue = (section: string, index: number, message: string) => issues.push({ section, index, message });
        if (geometry.polygons.length > 0xffff || geometry.sourceVertices.length > 0xffff) issue('header', -1, 'geometry count exceeds uint16');
        geometry.nodes.forEach((n, i) => {
            if (n.normalIndex >= geometry.normals.length && n.offset !== 0xffff) issue('nodes', i, 'normal index is out of range');
            if (n.offset !== 0xffff && (n.child1 >= geometry.nodes.length || n.child2 >= geometry.nodes.length)) issue('nodes', i, 'child node index is out of range');
        });
        geometry.leaves.forEach((leaf, i) => {
            if (leaf.polygonCount > 0x7f || i > 0x1ff) issue('leaves', i, 'packed leaf field is out of range');
            if (leaf.polygonOffset + leaf.polygonCount > geometry.polygons.length || leaf.vertexOffset > geometry.sourceVertices.length) issue('leaves', i, 'polygon/vertex range is out of bounds');
        });
        geometry.sourceVertices.forEach((v, i) => {
            if (![v.x, v.y, v.z].every(n => Number.isInteger(n) && n >= 0 && n <= 255)) issue('vertices', i, 'coordinates must fit uint8');
            if (![v.u, v.v].every(n => Number.isInteger(n) && n >= -128 && n <= 127)) issue('vertices', i, 'UVs must fit int8');
        });
        geometry.polygons.forEach((p, i) => {
            if (p.vertexCount < 2 || p.vertexCount > 9 || p.vertexStart < 0 || p.vertexStart + p.vertexCount > geometry.sourceVertices.length) issue('polygons', i, 'vertex range/count is invalid');
            if (p.textureId < 0 || p.textureId > SpecialTextureIds.WALL_OFFSET + 255) issue('polygons', i, 'texture id cannot be encoded');
            const vs = geometry.sourceVertices.slice(p.vertexStart, p.vertexStart + p.vertexCount);
            if (p.vertexCount === 2 && vs.length === 2 && vs[0].x === vs[1].x && vs[0].y === vs[1].y && vs[0].z === vs[1].z) issue('polygons', i, 'wall endpoints are identical');
            if (p.vertexCount >= 3 && this.signedArea(vs) === 0) issue('polygons', i, 'polygon is degenerate');
        });
        geometry.lines.forEach((l, i) => { if (l.flags < 0 || l.flags > 15) issue('lines', i, 'collision flags must fit four bits'); });
        if (geometry.heightMap.length !== 1024) issue('heightmap', -1, 'heightmap must contain 32 × 32 signed bytes');
        return issues;
    }

    assertValid(geometry: MapGeometry): void { const issues = this.validate(geometry); if (issues.length) throw new Error(issues.map(i => `${i.section}[${i.index}]: ${i.message}`).join('\n')); }
    findLeafAt(geometry: MapGeometry, x: number, y: number): number {
        return geometry.leaves.findIndex(l => { const n = geometry.nodes[l.nodeIndex]; return !!n && x >= n.minX && x <= n.maxX && y >= n.minY && y <= n.maxY; });
    }
    cloneEditable(geometry: MapGeometry): MapGeometry {
        const clone = structuredClone(geometry) as MapGeometry; clone.heightMap = geometry.heightMap.slice(); this.rebuildRenderData(clone); return clone;
    }

    private syncLeafNodes(g: MapGeometry) { g.leaves.forEach((l, i) => { if (l.nodeIndex >= 0) g.nodes[l.nodeIndex].child1 = (l.polygonCount << 9) | i; }); }
    private reindexPolygons(g: MapGeometry) { g.leaves.forEach((l, li) => { let v = l.vertexOffset; for (let p = l.polygonOffset; p < l.polygonOffset + l.polygonCount; p++) { g.polygons[p].leafIndex = li; g.polygons[p].vertexStart = v; v += g.polygons[p].vertexCount; } }); }
    private signedArea(v: MapVertexRecord[]) { let a = 0; for (let i = 0; i < v.length; i++) { const n = v[(i + 1) % v.length]; a += v[i].x * n.y - n.x * v[i].y; } return a; }
    private newellNormal(vertices: MapVertexRecord[]) {
        const normal = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i], b = vertices[(i + 1) % vertices.length];
            normal.x += (a.y - b.y) * (a.z + b.z);
            normal.y += (a.z - b.z) * (a.x + b.x);
            normal.z += (a.x - b.x) * (a.y + b.y);
        }
        return normal;
    }
    private pushVert(out: number[], uv: number[], p: MapVertexRecord, swap: boolean) { out.push(p.x * GeometryScale.GEO, p.z * GeometryScale.GEO, p.y * GeometryScale.GEO); uv.push(swap ? p.v : p.u, swap ? p.u : p.v); }
}
