import { Injectable, inject } from '@angular/core';
import {
    DoomGeometryService, MapGeometry, MapLineRecord, MapPolygonRecord, MapVertexRecord, NewPolygon
} from '../doom-geometry.service';

export interface PassageRequest {
    wallPolygonIndex: number;
    /** Horizontal opening range on X for an X-directed wall, otherwise on Y. */
    start: number;
    end: number;
    bottom: number;
    top: number;
}

export interface PassagePreview {
    leafIndexes: number[];
    polygonIndex: number;
    lineIndexes: number[];
    removedLines: MapLineRecord[];
    createdLines: MapLineRecord[];
    createdPolygons: NewPolygon[];
    requiresBspRebuild: boolean;
    /** This operation only edits leaf ranges; BSP nodes, normals and split planes stay untouched. */
    topologyUnchanged: true;
}

export interface PassageResult { geometry: MapGeometry; preview: PassagePreview; }

/**
 * Conservative first portal transaction. It accepts only grid-aligned walls
 * wholly contained by one existing leaf. A request which would need a spatial
 * partition rebuild is rejected before mutation rather than producing a
 * visual-only hole.
 */
@Injectable({ providedIn: 'root' })
export class BspPortalEditingService {
    /** Player clearance in map vertex units (Render/Game use 8 game units per stored height). */
    static readonly PLAYER_CLEARANCE = 7;
    private geometryService = inject(DoomGeometryService);

    preview(geometry: MapGeometry, request: PassageRequest): PassagePreview {
        const poly = geometry.polygons[request.wallPolygonIndex];
        if (!poly || poly.vertexCount !== 2 || poly.leafIndex < 0) throw new Error('Passage requires an encoded two-vertex wall polygon');
        if (![request.start, request.end, request.bottom, request.top].every(Number.isInteger)) throw new Error('Passage coordinates must be on the integer map grid');
        if (request.start >= request.end || request.bottom >= request.top) throw new Error('Passage rectangle must have positive width and height');
        const [a, b] = geometry.sourceVertices.slice(poly.vertexStart, poly.vertexStart + 2);
        const alongX = a.y === b.y && a.x !== b.x;
        const alongY = a.x === b.x && a.y !== b.y;
        if (!alongX && !alongY) throw new Error('The first passage builder supports only orthogonal walls');
        const horizontalA = alongX ? a.x : a.y;
        const horizontalB = alongX ? b.x : b.y;
        const min = Math.min(horizontalA, horizontalB), max = Math.max(horizontalA, horizontalB);
        const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
        if (request.start <= min || request.end >= max || request.bottom < minZ || request.top > maxZ) throw new Error('Passage must be strictly inside the selected wall');
        if (request.top - request.bottom < BspPortalEditingService.PLAYER_CLEARANCE) {
            throw new Error(`Passage height must be at least ${BspPortalEditingService.PLAYER_CLEARANCE} map units for the player`);
        }

        const leafIndex = poly.leafIndex;
        const corners = alongX
            ? [[request.start, a.y], [request.end, a.y]]
            : [[a.x, request.start], [a.x, request.end]];
        const requiresBspRebuild = corners.some(([x, y]) => this.geometryService.findLeafAt(geometry, x, y) !== leafIndex);
        if (requiresBspRebuild) throw new Error('Passage crosses a BSP split; safe BSP rebuilding is required and no changes were applied');

        const floorHeights = this.floorHeightsAcrossOpening(geometry, alongX, a, request.start, request.end);
        if (!floorHeights.length || floorHeights.some(floor => request.bottom < floor || request.bottom - floor > 1)) {
            throw new Error('Passage bottom must meet the floor (or a one-unit threshold) across both sides of the opening');
        }
        // Removing a 2D line makes the complete vertical column passable. A lower
        // wall fragment would therefore look solid while being non-colliding.
        if (request.bottom > minZ) {
            throw new Error('A hanging passage with a lower wall fragment cannot be represented by the 2D collision format');
        }

        const leaf = geometry.leaves[leafIndex];
        const lineIndexes: number[] = [];
        const removedLines: MapLineRecord[] = [], createdLines: MapLineRecord[] = [];
        for (let i = leaf.lineOffset; i < leaf.lineOffset + leaf.lineCount; i++) {
            const line = geometry.lines[i];
            const collinear = alongX ? line.y1 === a.y && line.y2 === a.y : line.x1 === a.x && line.x2 === a.x;
            const l1 = alongX ? line.x1 : line.y1, l2 = alongX ? line.x2 : line.y2;
            if (!collinear || Math.min(l1, l2) > request.start || Math.max(l1, l2) < request.end) continue;
            if (Math.min(l1, l2) !== min || Math.max(l1, l2) !== max) throw new Error(`Collision line ${i} only partially covers the wall; refusing an ambiguous passage`);
            lineIndexes.push(i); removedLines.push({ ...line });
            const forward = l1 <= l2;
            const segment = (from: number, to: number): MapLineRecord => alongX
                ? { flags: line.flags, x1: forward ? from : to, y1: a.y, x2: forward ? to : from, y2: a.y }
                : { flags: line.flags, x1: a.x, y1: forward ? from : to, x2: a.x, y2: forward ? to : from };
            createdLines.push(segment(min, request.start), segment(request.end, max));
        }
        if (lineIndexes.length !== 1) throw new Error('Passage requires exactly one proven collision line for the selected wall');

        const createdPolygons = this.wallFragments(poly, a, b, alongX, request);
        const newPolygonCount = leaf.polygonCount - 1 + createdPolygons.length;
        if (newPolygonCount > 0x7f) throw new Error('Passage fragments overflow the leaf packed polygonCount');
        if (leaf.lineCount + 1 > 0x3f) throw new Error('Passage collision fragments overflow the leaf packed lineCount');
        if (geometry.lines.length + 1 > 0xffff || geometry.polygons.length - 1 + createdPolygons.length > 0xffff ||
            geometry.sourceVertices.length - 2 + createdPolygons.length * 2 > 0xffff) throw new Error('Passage exceeds a uint16 geometry count');
        for (let i = leafIndex + 1; i < geometry.leaves.length; i++) {
            if (geometry.leaves[i].lineOffset + 1 > 0x3ff) throw new Error(`Passage overflows packed lineOffset for leaf ${i}`);
        }
        return { leafIndexes: [leafIndex], polygonIndex: request.wallPolygonIndex, lineIndexes, removedLines, createdLines, createdPolygons, requiresBspRebuild: false, topologyUnchanged: true };
    }

    private floorHeightsAcrossOpening(g: MapGeometry, alongX: boolean, wall: MapVertexRecord, start: number, end: number): number[] {
        const result = new Set<number>();
        const normalOffsets = [-1, 1];
        for (let h = start; h <= end; h++) for (const side of normalOffsets) {
            const x = alongX ? h : wall.x + side;
            const y = alongX ? wall.y + side : h;
            const tileX = Math.max(0, Math.min(31, x >> 3));
            const tileY = Math.max(0, Math.min(31, y >> 3));
            result.add(g.heightMap[tileY * 32 + tileX]);
        }
        return [...result];
    }

    createPassage(geometry: MapGeometry, request: PassageRequest): PassageResult {
        const snapshot = this.geometryService.cloneEditable(geometry);
        try {
            const preview = this.preview(geometry, request);
            const leafIndex = geometry.polygons[request.wallPolygonIndex].leafIndex;
            const relativeLine = preview.lineIndexes[0] - geometry.leaves[leafIndex].lineOffset;
            this.geometryService.removePolygon(geometry, request.wallPolygonIndex);
            for (const fragment of preview.createdPolygons) this.geometryService.addPolygon(geometry, fragment);
            this.geometryService.replaceLines(geometry, leafIndex, relativeLine, 1, preview.createdLines);
            this.geometryService.assertValid(geometry);
            return { geometry, preview };
        } catch (error) {
            Object.assign(geometry, snapshot);
            throw error;
        }
    }

    private wallFragments(poly: MapPolygonRecord, a: MapVertexRecord, b: MapVertexRecord, alongX: boolean, r: PassageRequest): NewPolygon[] {
        const low = (h: number, z: number): MapVertexRecord => ({
            x: alongX ? h : a.x, y: alongX ? a.y : h, z,
            u: a.u, v: a.v
        });
        const min = Math.min(alongX ? a.x : a.y, alongX ? b.x : b.y);
        const max = Math.max(alongX ? a.x : a.y, alongX ? b.x : b.y);
        const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
        const rectangles: Array<[number, number, number, number]> = [
            [min, r.start, minZ, maxZ], [r.end, max, minZ, maxZ]
        ];
        if (r.top < maxZ) rectangles.push([r.start, r.end, r.top, maxZ]);
        if (r.bottom > minZ) rectangles.push([r.start, r.end, minZ, r.bottom]);
        return rectangles.filter(([h1, h2, z1, z2]) => h1 < h2 && z1 < z2).map(([h1, h2, z1, z2]) => ({
            leafIndex: poly.leafIndex, textureId: poly.textureId, flags: poly.flags,
            vertices: [low(h1, z1), low(h2, z2)]
        }));
    }
}
