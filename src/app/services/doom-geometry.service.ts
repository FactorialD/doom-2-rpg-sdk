import { Injectable } from '@angular/core';
import { GeometryScale, PolyFlag } from '../core/constants/geometry';
import { SpecialTextureIds } from '../core/constants/texture-groups';

export interface MapGeometry {
    vertices: Float32Array;
    uvs: Float32Array;
    indices: number[];
    textureIds: number[];
    flags: number[];
    polyVertexCounts: number[];
}

@Injectable({
    providedIn: 'root'
})
export class DoomGeometryService {
    
    processGeometry(
        numNodes: number,
        numPolys: number,
        numVerts: number,
        // Node structures - Using Uint16Array (0-65535)
        nodeOffsets: Uint16Array,
        nodeChildOffset1: Uint16Array,
        nodePolyOffset: Uint16Array,
        nodeVertOffset: Uint16Array,
        // Poly Data
        polyTex: Uint8Array,
        polyFlags: Uint8Array,
        // Vertex Data (Raw Bytes)
        polyXs: Uint8Array,
        polyYs: Uint8Array,
        polyZs: Uint8Array,
        polyUs: Int8Array, // Signed!
        polyVs: Int8Array  // Signed!
    ): MapGeometry {
        
        const verts: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const textureIds: number[] = [];
        const flagsList: number[] = [];
        const polyVertexCounts: number[] = [];

        let globalVertIndex = 0;

        // Iterate through all nodes to find leaves
        for (let i = 0; i < numNodes; i++) {
            // Check if leaf node. In Unsigned 16-bit, -1 becomes 65535.
            if (nodeOffsets[i] === 65535) {
                const child1 = nodeChildOffset1[i];
                // Extract counts from bit-packed value
                const polyCount = (child1 >> 9) & 127;
                const leafIndex = child1 & 511;

                let currentPolyIdx = nodePolyOffset[leafIndex];
                let currentVertIdx = nodeVertOffset[leafIndex];
                const endPolyIdx = currentPolyIdx + polyCount;

                for (; currentPolyIdx < endPolyIdx; currentPolyIdx++) {
                    // With correct Uint16 reading, these indices are trusted to be within bounds of a valid map.
                    if (currentPolyIdx >= numPolys) continue;

                    const flags = polyFlags[currentPolyIdx];
                    const rawTexId = polyTex[currentPolyIdx];

                    // Resolve Texture ID based on flags
                    let texId = rawTexId;
                    // POLY_FLAG_WALL_TEXTURE (32) -> Use Wall textures range
                    if ((flags & PolyFlag.WallTexture) !== 0) {
                        texId += SpecialTextureIds.WALL_OFFSET;
                    }

                    // Vertex count: (flags & 7) + 2. (Min 2, Max 9)
                    const vCount = (flags & 7) + 2;
                    
                    const swapXY = (flags & PolyFlag.SwapXY) !== 0; 
                    const uvDelta = (flags & PolyFlag.UVDeltaX) !== 0; 
                    const extrusionType = flags & PolyFlag.AxisMask; 

                    // --- Wall Extrusion (2 vertices -> Quad) ---
                    if (vCount === 2) {
                        // Extract base vertices (v0 and v1)
                        const p0 = this.getVert(currentVertIdx, polyXs, polyYs, polyZs, polyUs, polyVs);
                        const p1 = this.getVert(currentVertIdx + 1, polyXs, polyYs, polyZs, polyUs, polyVs);

                        // Construct the 4 quad corners
                        // Order based on Render.java: mv[0], mv[1], mv[2]=mv[1], mv[3]=mv[0]
                        const q0 = { ...p0 }; 
                        const q1 = { ...p0 }; 
                        const q2 = { ...p1 }; 
                        const q3 = { ...p1 }; 

                        // Extrusion Logic
                        if (extrusionType === PolyFlag.AxisZ) { 
                            // Doom Z-Axis (Height)
                            q1.y = q2.y; 
                            q3.y = q0.y; 
                        } else if (extrusionType === PolyFlag.AxisX) {
                             // Doom X-Axis
                            q1.x = q2.x;
                            q3.x = q0.x;
                        } else if (extrusionType === PolyFlag.AxisY) {
                            // Doom Y-Axis (Depth)
                            q1.z = q2.z;
                            q3.z = q0.z;
                        } else {
                            q1.y = q2.y;
                            q3.y = q0.y;
                        }

                        // UV Logic for Walls
                        if (uvDelta) {
                            q1.u = q2.u;
                            q3.u = q0.u;
                        } else {
                            q1.v = q2.v;
                            q3.v = q0.v;
                        }

                        // Push Vertices as a Quad (Two Triangles)
                        // FORCE swapXY to false for Walls. Walls in Doom 2 RPG are typically vertical.
                        // If they appear sideways, it's because swapXY was incorrectly applied or defaulted.
                        this.pushVert(verts, uvs, q0, false);
                        this.pushVert(verts, uvs, q1, false);
                        this.pushVert(verts, uvs, q2, false);
                        
                        this.pushVert(verts, uvs, q3, false); // 4th vertex
                        
                        indices.push(globalVertIndex, globalVertIndex + 1, globalVertIndex + 2);
                        indices.push(globalVertIndex, globalVertIndex + 2, globalVertIndex + 3);
                        
                        polyVertexCounts.push(4);
                        globalVertIndex += 4;
                        currentVertIdx += 2; 

                    } else {
                        // --- Standard N-Gon (Floor/Ceiling) ---
                        const firstVert = globalVertIndex;

                        for (let v = 0; v < vCount; v++) {
                            const p = this.getVert(currentVertIdx, polyXs, polyYs, polyZs, polyUs, polyVs);
                            this.pushVert(verts, uvs, p, swapXY);
                            globalVertIndex++;
                            currentVertIdx++;
                        }

                        // Triangulate Fan (0-1-2, 0-2-3, ...)
                        for (let v = 2; v < vCount; v++) {
                            indices.push(firstVert, firstVert + v - 1, firstVert + v);
                        }
                        
                        polyVertexCounts.push(vCount);
                    }

                    textureIds.push(texId);
                    flagsList.push(flags);
                }
            }
        }

        return {
            vertices: new Float32Array(verts),
            uvs: new Float32Array(uvs),
            indices,
            textureIds,
            flags: flagsList,
            polyVertexCounts
        };
    }

    private getVert(
        idx: number, 
        xs: Uint8Array, ys: Uint8Array, zs: Uint8Array, 
        us: Int8Array, vs: Int8Array
    ) {
        // Direct access. Assuming valid map data and correct indices (Uint16).
        return {
            x: xs[idx] * GeometryScale.GEO,
            y: zs[idx] * GeometryScale.GEO,
            z: ys[idx] * GeometryScale.GEO,
            u: us[idx],
            v: vs[idx]
        };
    }

    private pushVert(
        verts: number[], 
        uvs: number[], 
        p: {x:number, y:number, z:number, u:number, v:number},
        swapXY: boolean
    ) {
        verts.push(p.x, p.y, p.z);
        if (swapXY) {
            uvs.push(p.v, p.u);
        } else {
            uvs.push(p.u, p.v);
        }
    }
}