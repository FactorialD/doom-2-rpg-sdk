import { Injectable, inject } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream, MAP_FIRST_MARKER, MAP_MARKER, checkedLength, readMarker } from '../utils/byte-stream';
import { DoomGeometryService, MapGeometry } from './doom-geometry.service';
import { unpackSpriteTextureId } from './map/map-texture-id';
import { GeometryScale, PolyFlag } from '../core/constants/geometry';
import { MapSerializer } from './map/map-serializer';
import { MapCoordinateService } from './map/map-coordinate.service';
import { ScriptData, DoomScriptService } from './doom-script.service';

export type { MapGeometry };

export interface MapData {
    header: MapHeader;
    geometry: MapGeometry;
    sprites: MapSprite[];
    bspTree: BspNode;
    heightMap: Int8Array; // 32x32 grid of floor heights
    scripts?: ScriptData; // Added scripts
    remainderOffset: number; // File offset where scripts/remainder starts
}

export interface MapHeader {
    spawnIndex: number;
    spawnDir: number;
    numPolys: number;
    numVerts: number;
    numSprites: number;
}

export interface MapSprite {
    uuid: string; // Unique ID for tracking references
    x: number; // Game Units
    y: number; // Game Units (Height / Java Z)
    z: number; // Game Units (Depth / Java Y)
    textureId: number;
    flatIndex: number;
    flags: number;
    type: 'normal' | 'z'; // 'normal' = usually grounded, 'z' = specific height (flying/ceiling)
    extraInfo: number; // Preserves the "Extra Info" byte for Z-sprites (usually animation state)
}

export interface BspNode {
    id: number;
    isLeaf: boolean;
    bounds: { minX: number, minY: number, maxX: number, maxY: number };
    left?: BspNode;
    right?: BspNode;
    polyCount?: number;
    leafIndex?: number;
}

export interface MapEntityLocation {
    mapId: number;
    spriteIndex: number;
    x: number;
    y: number; // Z in game terms
    z: number; // Y in game terms
}

@Injectable({
    providedIn: 'root'
})
export class DoomMapService {
    private fileService = inject(DoomFileService);
    private geometryService = inject(DoomGeometryService);
    private serializer = inject(MapSerializer);
    private coordinateService = inject(MapCoordinateService);
    private scriptService = inject(DoomScriptService);

    // Use extracted constant
    private readonly SPRITE_SCALE = GeometryScale.SPRITE;

    /**
     * Scans all available map files for sprites matching a specific Texture ID (EntityDef tileIndex).
     * Skips heavy geometry parsing for performance.
     */
    async findSpriteLocations(targetTileIndex: number): Promise<MapEntityLocation[]> {
        const locations: MapEntityLocation[] = [];
        const totalMaps = 9;

        for (let mapId = 1; mapId <= totalMaps; mapId++) {
            const mapFileName = `map0${mapId - 1}.bin`;
            const buffer = this.fileService.getFile(mapFileName);

            if (!buffer) continue;

            try {
                const stream = new ByteStream(buffer, true, mapFileName);

                stream.skip(11);

                // Read Counts needed for skipping
                const numNodes = stream.readUShort();
                const numLeafNodes = stream.readUShort();
                const numLines = stream.readUShort();
                const numNormals = stream.readUShort();
                const numPolys = stream.readUShort();
                const numVerts = stream.readUShort();
                const numNormalSprites = stream.readUShort();
                const numZSprites = stream.readShort();
                checkedLength(numZSprites, 1, mapFileName, 'header sprite count', 25);

                stream.skip(19);

                // --- Skip Media ---
                readMarker(stream, MAP_FIRST_MARKER, 'media registration');
                const mediaCount = stream.readUShort();
                stream.skip(mediaCount * 2);

                // --- Skip Geometry ---
                readMarker(stream, MAP_FIRST_MARKER, 'normals');
                stream.skip(numNormals * 3 * 2);

                readMarker(stream, MAP_MARKER, 'node offsets');
                stream.skip(numNodes * 2);

                readMarker(stream, MAP_MARKER, 'node normal indices');
                stream.skip(numNodes);

                readMarker(stream, MAP_MARKER, 'node children');
                stream.skip(numNodes * 2);
                stream.skip(numNodes * 2); // child2

                readMarker(stream, MAP_MARKER, 'node bounds');
                stream.skip(numNodes * 2);
                stream.skip(numNodes * 2);

                readMarker(stream, MAP_MARKER, 'leaf offsets');
                stream.skip(numLeafNodes * 2);
                stream.skip(numLeafNodes * 2);

                readMarker(stream, MAP_MARKER, 'polygons');
                stream.skip(numPolys); // tex
                stream.skip(numPolys); // flags
                stream.skip(numVerts * 5); // x,y,z,u,v

                readMarker(stream, MAP_MARKER, 'lines');
                const lineFlagsLen = Math.floor((numLines + 1) / 2);
                stream.skip(lineFlagsLen);
                stream.skip(numLines * 2);
                stream.skip(numLines * 2);

                readMarker(stream, MAP_MARKER, 'heightmap');
                stream.skip(1024);

                // --- Read Sprites ---
                readMarker(stream, MAP_MARKER, 'sprites');
                const numMapSprites = numNormalSprites + numZSprites;
                stream.ensureAvailable(
                    checkedLength(numMapSprites, 5, mapFileName, 'sprites', stream.position),
                    'sprites'
                );

                const spriteXs = new Int16Array(numMapSprites);
                const spriteYs = new Int16Array(numMapSprites);

                for(let i=0; i<numMapSprites; i++) spriteXs[i] = (stream.readUByte() << 3);
                for(let i=0; i<numMapSprites; i++) spriteYs[i] = (stream.readUByte() << 3);

                // Info (Texture ID low byte)
                const spriteInfoLow = stream.readByteArray(numMapSprites);

                readMarker(stream, MAP_MARKER, 'sprite flags');
                // Flags (Texture ID high bits)
                const spriteFlags = new Int32Array(numMapSprites);
                for(let i=0; i<numMapSprites; i++) spriteFlags[i] = stream.readUShort();

                for (let i = 0; i < numMapSprites; i++) {
                    const localTexId = spriteInfoLow[i];
                    const flags = spriteFlags[i];

                    const texId = unpackSpriteTextureId(localTexId, flags);

                    if (texId === targetTileIndex) {
                        locations.push({
                            mapId: mapId,
                            spriteIndex: i,
                            x: spriteXs[i] * this.SPRITE_SCALE,
                            z: spriteYs[i] * this.SPRITE_SCALE,
                            y: 0
                        });
                    }
                }
            } catch (e) {
                console.warn(`Error scanning map ${mapId} for sprites`, e);
            }
        }
        return locations;
    }

    async loadMap(mapId: number): Promise<MapData | null> {
        const mapFileName = `map0${mapId - 1}.bin`;
        const buffer = this.fileService.getFile(mapFileName);

        if (!buffer) {
            console.error(`Map file ${mapFileName} not found`);
            return null;
        }

        const stream = new ByteStream(buffer, true, mapFileName);

        // --- 1. Read Header ---
        stream.skip(1); // Ver
        stream.skip(4); // Date
        const spawnIndex = stream.readUShort(); // Offset 5
        const spawnDir = stream.readUByte();    // Offset 7
        stream.skip(3); // Flags, Secrets, Loot (Offsets 8, 9, 10)

        // Counts (Starting at Offset 11)
        const numNodes = stream.readUShort();
        const numLeafNodes = stream.readUShort();
        const numLines = stream.readUShort();
        const numNormals = stream.readUShort();
        const numPolys = stream.readUShort();
        const numVerts = stream.readUShort();
        const numNormalSprites = stream.readUShort();
        const numZSprites = stream.readShort();
        checkedLength(numZSprites, 1, mapFileName, 'header sprite count', 25);

        // Rest of header (TileEvents(2) + ByteCode(2) + Cam(1) + CamKeys(2) + Tweens(12))
        stream.skip(19);

        // --- 2. Read Media Registration ---
        readMarker(stream, MAP_FIRST_MARKER, 'media registration');
        const mediaCount = stream.readUShort();
        stream.skip(mediaCount * 2);

        // --- 3. Read Geometry Data Structures ---
        readMarker(stream, MAP_FIRST_MARKER, 'normals');
        const normals = new Int16Array(numNormals * 3);
        for (let i = 0; i < normals.length; i++) normals[i] = stream.readShort();

        readMarker(stream, MAP_MARKER, 'node offsets');
        const nodeOffsets = stream.readUint16Array(numNodes);

        readMarker(stream, MAP_MARKER, 'node normal indices');
        const nodeNormalIdxs = stream.readByteArray(numNodes);

        readMarker(stream, MAP_MARKER, 'node children');
        const nodeChildOffset1 = stream.readUint16Array(numNodes);
        const nodeChildOffset2 = stream.readUint16Array(numNodes);

        readMarker(stream, MAP_MARKER, 'node bounds');
        const nodeBoundXs = stream.readByteArray(numNodes * 2);
        const nodeBoundYs = stream.readByteArray(numNodes * 2);

        readMarker(stream, MAP_MARKER, 'leaf offsets');
        const nodeVertOffset = stream.readUint16Array(numLeafNodes);
        const nodePolyOffset = stream.readUint16Array(numLeafNodes);

        // --- 4. Read Polygons and Vertices ---
        readMarker(stream, MAP_MARKER, 'polygons');
        const polyTex = stream.readByteArray(numPolys);
        const polyFlags = stream.readByteArray(numPolys);
        const polyXs = stream.readByteArray(numVerts);
        const polyYs = stream.readByteArray(numVerts);
        const polyZs = stream.readByteArray(numVerts);
        const polyUsU8 = stream.readByteArray(numVerts);
        const polyVsU8 = stream.readByteArray(numVerts);
        const polyUs = new Int8Array(polyUsU8.buffer);
        const polyVs = new Int8Array(polyVsU8.buffer);

        // --- 5. Read Sprites ---
        readMarker(stream, MAP_MARKER, 'lines');
        const lineFlags = stream.readByteArray(Math.floor((numLines + 1) / 2));
        const lineXs = stream.readByteArray(numLines * 2);
        const lineYs = stream.readByteArray(numLines * 2);

        readMarker(stream, MAP_MARKER, 'heightmap');
        const heightMapU8 = stream.readByteArray(1024);
        const heightMap = new Int8Array(heightMapU8.buffer);

        readMarker(stream, MAP_MARKER, 'sprites');
        const numMapSprites = numNormalSprites + numZSprites;
        stream.ensureAvailable(
            checkedLength(numMapSprites, 5, mapFileName, 'sprites', stream.position),
            'sprites'
        );

        // Read Sprites X/Y (Stored as byte << 3 in file, so actual val is byte * 8)
        const spriteXs = new Int16Array(numMapSprites);
        const spriteYs = new Int16Array(numMapSprites);
        // This array will hold the raw Z value from file (if exists) or base value
        const spriteZs = new Int16Array(numMapSprites);
        const spriteExtras = new Uint8Array(numMapSprites);

        for(let i=0; i<numMapSprites; i++) spriteXs[i] = (stream.readUByte() << 3);
        for(let i=0; i<numMapSprites; i++) spriteYs[i] = (stream.readUByte() << 3);

        // Init Normal Sprites Z to 32 (default center offset)
        for(let i=0; i<numNormalSprites; i++) spriteZs[i] = 32;

        const spriteInfoLow = stream.readByteArray(numMapSprites);

        readMarker(stream, MAP_MARKER, 'sprite flags');
        const spriteFlags = new Int32Array(numMapSprites);
        for(let i=0; i<numMapSprites; i++) spriteFlags[i] = stream.readUShort();

        readMarker(stream, MAP_MARKER, 'sprite z coordinates');
        // Read Z-coords for Z-Sprites ONLY (stored sequentially for the last numZSprites)
        for(let i=0; i<numZSprites; i++) {
             spriteZs[numNormalSprites + i] = stream.readUByte();
        }

        readMarker(stream, MAP_MARKER, 'sprite extra data');
        // Read Extra Info for Z-Sprites ONLY
        for(let i=0; i<numZSprites; i++) {
             spriteExtras[numNormalSprites + i] = stream.readUByte();
        }

        // CAPTURE OFFSET FOR SERIALIZER
        // This is where the sprite section ends and the rest of the file (scripts etc) begins
        const remainderOffset = stream.position;

        // --- Process Geometry (Delegated) ---
        const geometry = this.geometryService.processGeometry(
            normals, nodeOffsets, nodeNormalIdxs, nodeChildOffset1, nodeChildOffset2,
            nodeBoundXs, nodeBoundYs, nodePolyOffset, nodeVertOffset,
            polyTex, polyFlags,
            polyXs, polyYs, polyZs, polyUs, polyVs,
            lineFlags, lineXs, lineYs, heightMap
        );

        const bspTree = this.buildBspTree(0, nodeOffsets, nodeChildOffset1, nodeChildOffset2, nodeBoundXs, nodeBoundYs);

        // --- Process Sprites Post-Processing (Logic from Render.java) ---
        const sprites: MapSprite[] = [];

        for(let i=0; i<numMapSprites; i++) {
            let x = spriteXs[i]; // Raw game units (0-2040)
            let y = spriteYs[i]; // Raw game units (0-2040)
            let z = spriteZs[i]; // Base Z

            // Get Floor Height from HeightMap
            const gridX = x >> 6; // x / 64
            const gridY = y >> 6; // y / 64

            let floorHeight = 0;
            if (gridX >= 0 && gridX < 32 && gridY >= 0 && gridY < 32) {
                 const idx = (gridY * 32) + gridX;
                 floorHeight = heightMap[idx] << 3; // Height in game units
            }

            // Apply Z Logic from Render.postProcessSprites
            z = z + floorHeight;

            const isZSprite = i >= numNormalSprites;

            if (isZSprite) {
                z = z - 32;
            }

            // Determine Texture ID
            const localTexId = spriteInfoLow[i];
            const flags = spriteFlags[i];

            const texId = unpackSpriteTextureId(localTexId, flags);

            sprites.push({
                uuid: crypto.randomUUID(),
                x: x,
                y: z,
                z: y,
                textureId: texId,
                flatIndex: i,
                flags: flags,
                type: isZSprite ? 'z' : 'normal',
                extraInfo: spriteExtras[i]
            });
        }

        const scripts = await this.scriptService.loadAndDisassemble(mapId, true);
        if (scripts) {
            this.scriptService.linkEntitiesToScripts(scripts, sprites);
        }

        return {
            header: {
                spawnIndex, spawnDir, numPolys, numVerts, numSprites: numMapSprites
            },
            geometry,
            sprites,
            bspTree,
            heightMap,
            scripts: scripts || undefined,
            remainderOffset
        };
    }

    /**
     * Saves the modified MapData back to the file system.
     */
    saveMap(mapId: number, data: MapData): boolean {
        const mapFileName = `map0${mapId - 1}.bin`;
        const originalBuffer = this.fileService.getFile(mapFileName);

        if (!originalBuffer) {
            console.error("Original map file not found, cannot save.");
            return false;
        }

        try {
            this.sortSprites(data);
            const newBuffer = this.serializer.serialize(data, originalBuffer, mapFileName);
            this.fileService.saveBuffer(mapFileName, newBuffer.buffer);
            return true;
        } catch (e) {
            console.error("Failed to save map", e);
            return false;
        }
    }

    sortSprites(mapData: MapData) {
        // Sort sprites: Normal sprites first, then Z-sprites
        const normalSprites: MapSprite[] = [];
        const zSprites: MapSprite[] = [];

        for (const spr of mapData.sprites) {
            const analysis = this.coordinateService.analyzeSpriteType(mapData, spr);
            if (analysis.type === 'normal') {
                normalSprites.push(spr);
            } else {
                zSprites.push(spr);
            }
        }

        mapData.sprites = [...normalSprites, ...zSprites];

        // Update flatIndex for all sprites to match their new position
        mapData.sprites.forEach((s, i) => s.flatIndex = i);
    }

    private buildBspTree(nodeIdx: number, offsets: Uint16Array, c1: Uint16Array, c2: Uint16Array, bX: Uint8Array, bY: Uint8Array): BspNode {
        const isLeaf = offsets[nodeIdx] === 65535;
        const SCALE = 128.0;

        const safeGet = (arr: Uint8Array, idx: number) => (idx >= 0 && idx < arr.length) ? arr[idx] : 0;
        const minX = safeGet(bX, nodeIdx * 2) * SCALE;
        const maxX = safeGet(bX, nodeIdx * 2 + 1) * SCALE;
        const minY = safeGet(bY, nodeIdx * 2) * SCALE;
        const maxY = safeGet(bY, nodeIdx * 2 + 1) * SCALE;

        const node: BspNode = {
            id: nodeIdx,
            isLeaf,
            bounds: { minX, minY, maxX, maxY }
        };

        if (isLeaf) {
            const val = c1[nodeIdx];
            node.polyCount = (val >> 9) & 127;
            node.leafIndex = val & 511;
        } else {
            const leftIdx = c1[nodeIdx];
            const rightIdx = c2[nodeIdx];
            if (leftIdx < offsets.length && rightIdx < offsets.length && leftIdx !== nodeIdx && rightIdx !== nodeIdx) {
                node.left = this.buildBspTree(leftIdx, offsets, c1, c2, bX, bY);
                node.right = this.buildBspTree(rightIdx, offsets, c1, c2, bX, bY);
            }
        }
        return node;
    }

}
