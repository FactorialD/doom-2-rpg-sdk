import { Injectable, inject } from '@angular/core';
import { MapData, MapSprite } from '../doom-map.service';
import { ByteStream, BinaryWriter, MAP_FIRST_MARKER, MAP_MARKER, checkedLength, readMarker } from '../../utils/byte-stream';
import { TextureGroupIds } from '../../core/constants/texture-groups';
import { SpriteFlag } from '../../core/constants/map-flags';
import { MapCoordinateService } from './map-coordinate.service';
import { DoomScriptService } from '../doom-script.service';
import { ScriptCompilerService } from '../scripts/script-compiler.service';
import { MapValidationService } from './map-validation.service';
import { packMapTextureId, packPolygonTextureId, packSpriteTextureId } from './map-texture-id';

@Injectable({
    providedIn: 'root'
})
export class MapSerializer {
    private reader!: ByteStream;
    private writer!: BinaryWriter;
    private coordinateService = inject(MapCoordinateService);
    private scriptService = inject(DoomScriptService);
    private scriptCompiler = inject(ScriptCompilerService);
    private validation = inject(MapValidationService);

    // Context
    private mapData!: MapData;
    private sortedSprites: MapSprite[] = [];
    private head_numPolys: number = 0;
    private head_numLines: number = 0;
    private old_numNodes = 0;
    private old_numLeaf = 0;
    private old_numNormals = 0;
    private old_numVerts = 0;
    private copiedMarkerCount: number = 0;

    serialize(mapData: MapData, originalBuffer: ArrayBuffer, fileName: string = 'map file'): Uint8Array<ArrayBuffer> {
        // Optional only for the deliberately injector-free byte-shape unit fixture.
        const validationErrors = this.validation?.validate(mapData) ?? [];
        if (validationErrors.length) throw new Error(`Map validation failed:\n${validationErrors.join('\n')}`);
        this.mapData = mapData;
        this.reader = new ByteStream(originalBuffer, true, fileName);
        this.reader.ensureAvailable(46, 'header');
        this.copiedMarkerCount = 0;

        // Use auto-expanding BinaryWriter
        this.writer = new BinaryWriter(originalBuffer.byteLength + 4096);

        // 1. Prepare Data
        this.prepareSprites();
        this.validateGeometry();

        // 2. Write Sections
        this.writeHeader();
        this.writeMedia();
        this.writeGeometryStructures();
        this.writePolygons();
        this.writeBSPAndHeightmap();

        // Skip old sprite section in reader to reach scripts
        this.skipOldSprites();

        // 3. Write NEW Sprites
        this.writeSprites();

        // 4. Handle Scripts
        let compiledBytecode: Uint8Array | null = null;
        let numTileEvents = 0;
        let newStaticFuncs: number[] = [];
        let newTileEvents: Int32Array = new Int32Array(0);

        if (this.mapData.scripts) {
            // Update script indices based on current sprite order
            const success = this.scriptService.updateScriptIndices(this.mapData.scripts, this.sortedSprites);
            if (!success) {
                throw new Error("Map serialization aborted: an entity UUID is missing or its sprite index does not fit the script operand.");
            }

            // Compile scripts
            const compileResult = this.scriptCompiler.compile(
                this.mapData.scripts.instructions,
                this.mapData.scripts.staticFuncs,
                this.mapData.scripts.tileEventRefs,
                this.mapData.scripts.tileEvents
            );

            if (compileResult.errors.length > 0) {
                console.error("MapSerializer: Script compilation errors:", compileResult.errors);
                // Fallback to original remainder if compile fails? Or just write empty?
                // For now, let's just use the compiled binary even if there are errors, or throw.
                throw new Error("Script compilation failed: " + compileResult.errors.join("\n"));
            }

            compiledBytecode = compileResult.binary;
            numTileEvents = compileResult.newTileEvents.length / 2;
            newStaticFuncs = compileResult.newStaticFuncs;
            newTileEvents = compileResult.newTileEvents;

            // Skip old scripts in reader
            this.skipOldScripts();

            // Write new scripts
            this.writeScripts(newStaticFuncs, newTileEvents, compiledBytecode);
        }

        // 5. Copy remainder (Cameras, etc.)
        const remainderPos = this.reader.position;
        const remaining = this.reader.length - remainderPos;

        if (remaining > 0) {
            this.copyBytes(remaining);
        }

        const finalBuffer = this.writer.getData();

        // Patch header with new script sizes if we compiled them
        if (compiledBytecode) {
            const patchView = new DataView(finalBuffer.buffer, finalBuffer.byteOffset, finalBuffer.byteLength);
            patchView.setInt16(27, numTileEvents, true);
            patchView.setInt16(29, compiledBytecode.length, true);
        }

        return finalBuffer;
    }

    private prepareSprites() {
        // Sprites are already sorted by `DoomMapService.sortSprites` (Normal then Z-Sprites).
        // We just need to count them.
        this.sortedSprites = this.mapData.sprites;
    }

    private writeHeader() {
        this.copyBytes(11); // Version...Flags

        this.old_numNodes = this.reader.readUShort(); this.writer.writeUShort(this.mapData.geometry.nodes.length);
        this.old_numLeaf = this.reader.readUShort(); this.writer.writeUShort(this.mapData.geometry.leaves.length);
        this.head_numLines = this.reader.readUShort(); this.writer.writeUShort(this.mapData.geometry.lines.length);
        this.old_numNormals = this.reader.readUShort(); this.writer.writeUShort(this.mapData.geometry.normals.length);
        this.head_numPolys = this.reader.readUShort(); this.writer.writeUShort(this.mapData.geometry.polygons.length);
        this.old_numVerts = this.reader.readUShort(); this.writer.writeUShort(this.mapData.geometry.sourceVertices.length);

        // Skip original sprite counts
        this.reader.readUShort();
        this.reader.readShort();

        // Write NEW sprite counts
        let normalCount = 0;
        let zCount = 0;
        for (const spr of this.sortedSprites) {
            const analysis = this.coordinateService.analyzeSpriteType(this.mapData, spr);
            if (analysis.type === 'normal') normalCount++;
            else zCount++;
        }

        this.writer.writeUShort(normalCount); // Normal Sprites Count
        this.writer.writeShort(zCount); // Z Sprites Count

        this.copyBytes(19); // Rest of header
    }

    private writeMedia() {
        this.copyMarker(); // Media Marker

        // Build unique media list
        const mediaSet = new Set<number>();

        const oldMediaCount = this.reader.readUShort();

        const tempReaderPos = this.reader.position;
        for(let i=0; i<oldMediaCount; i++) {
            mediaSet.add(this.reader.readUShort());
        }
        this.reader.position = tempReaderPos;
        this.reader.skip(oldMediaCount * 2);

        for(const tid of this.mapData.geometry.textureIds) mediaSet.add(tid);
        for(const spr of this.mapData.sprites) mediaSet.add(spr.textureId);

        const finalMediaList = Array.from(mediaSet).sort((a,b) => a - b);

        this.writer.writeUShort(finalMediaList.length);
        for(const mid of finalMediaList) this.writer.writeUShort(mid);
    }

    private writeGeometryStructures() {
        const g = this.mapData.geometry;
        this.copyMarker(); this.reader.skip(this.old_numNormals * 6);
        for (const n of g.normals) { this.writer.writeShort(n.x); this.writer.writeShort(n.y); this.writer.writeShort(n.z); }
        this.copyMarker(); this.reader.skip(this.old_numNodes * 2); for (const n of g.nodes) this.writer.writeUShort(n.offset);
        this.copyMarker(); this.reader.skip(this.old_numNodes); for (const n of g.nodes) this.writer.writeUByte(n.normalIndex);
        this.copyMarker(); this.reader.skip(this.old_numNodes * 4);
        for (const n of g.nodes) this.writer.writeUShort(n.child1); for (const n of g.nodes) this.writer.writeUShort(n.child2);
        this.copyMarker(); this.reader.skip(this.old_numNodes * 4);
        for (const n of g.nodes) { this.writer.writeUByte(n.minX); this.writer.writeUByte(n.maxX); }
        for (const n of g.nodes) { this.writer.writeUByte(n.minY); this.writer.writeUByte(n.maxY); }
        this.copyMarker(); this.reader.skip(this.old_numLeaf * 4);
        for (const l of g.leaves) this.writer.writeUShort(l.vertexOffset);
        for (const l of g.leaves) this.writer.writeUShort(l.polygonOffset);
    }

    private writePolygons() {
        this.copyMarker();
        const g = this.mapData.geometry;
        this.reader.skip(this.head_numPolys * 2 + this.old_numVerts * 5);
        for (const poly of g.polygons) {
            this.writer.writeUByte(packPolygonTextureId(poly.textureId, poly.flags).packedId);
        }
        for (const poly of g.polygons) {
            this.writer.writeUByte(packPolygonTextureId(poly.textureId, poly.flags).flags);
        }
        for (const v of g.sourceVertices) this.writer.writeUByte(v.x);
        for (const v of g.sourceVertices) this.writer.writeUByte(v.y);
        for (const v of g.sourceVertices) this.writer.writeUByte(v.z);
        for (const v of g.sourceVertices) this.writer.writeByte(v.u);
        for (const v of g.sourceVertices) this.writer.writeByte(v.v);
    }

    private writeBSPAndHeightmap() {
        const lines = this.mapData.geometry.lines;
        this.copyMarker();
        this.reader.skip(Math.floor((this.head_numLines + 1) / 2) + this.head_numLines * 4);
        for (let i = 0; i < lines.length; i += 2) this.writer.writeUByte(lines[i].flags | ((lines[i + 1]?.flags ?? 0) << 4));
        for (const line of lines) { this.writer.writeUByte(line.x1); this.writer.writeUByte(line.x2); }
        for (const line of lines) { this.writer.writeUByte(line.y1); this.writer.writeUByte(line.y2); }

        this.copyMarker();
        this.reader.skip(1024);
        for (const value of this.mapData.heightMap) this.writer.writeByte(value);
    }

    private skipOldSprites() {
        const peekReader = this.reader.createReader();
        peekReader.position = 23;
        const oldNumNormal = peekReader.readUShort();
        const oldNumZ = peekReader.readShort();
        checkedLength(oldNumZ, 1, this.reader.fileName, 'header z-sprite count', 25);
        const oldTotal = oldNumNormal + oldNumZ;

        readMarker(this.reader, MAP_MARKER, 'sprites');
        this.reader.skip(oldTotal * 3); // X,Y,Info
        readMarker(this.reader, MAP_MARKER, 'sprite flags');
        this.reader.skip(oldTotal * 2);
        readMarker(this.reader, MAP_MARKER, 'sprite z coordinates');
        this.reader.skip(oldNumZ);
        readMarker(this.reader, MAP_MARKER, 'sprite extra data');
        this.reader.skip(oldNumZ);
    }

    private writeSprites() {
        this.writeMarker();

        const newTotal = this.sortedSprites.length;

        // 2. Xs and Ys (Game Units / 8)
        for (const spr of this.sortedSprites) {
            const packedX = Math.min(255, Math.max(0, Math.round(spr.x / 8)));
            this.writer.writeUByte(packedX);
        }
        for (const spr of this.sortedSprites) {
            const packedY = Math.min(255, Math.max(0, Math.round(spr.z / 8)));
            this.writer.writeUByte(packedY);
        }

        // 3. Info (Texture ID Low Byte)
        const flagsArr = new Uint32Array(newTotal);

        for (let i = 0; i < newTotal; i++) {
            const spr = this.sortedSprites[i];
            const packed = packSpriteTextureId(spr.textureId, spr.flags);
            let tid = packed.packedId;
            let flagVal = packed.flags;

            const isMonster = tid >= TextureGroupIds.MONSTER_START && tid <= TextureGroupIds.MONSTER_END;
            const isNPC = tid >= TextureGroupIds.NPC_START && tid <= TextureGroupIds.NPC_END;

            if (isMonster || isNPC) {
                if ((flagVal & SpriteFlag.Flat) !== 0) {
                    flagVal &= ~SpriteFlag.Flat;
                }
            }

            if (tid > 255) tid = 255;

            this.writer.writeUByte(tid);
            flagsArr[i] = flagVal;
        }

        // 4. Marker + Flags
        this.writeMarker();
        for (let i = 0; i < newTotal; i++) this.writer.writeUShort(flagsArr[i]);

        // 5. Marker + Z Coords (Only for Z-Sprites)
        this.writeMarker();

        for (const spr of this.sortedSprites) {
             const analysis = this.coordinateService.analyzeSpriteType(this.mapData, spr);
             if (analysis.type === 'z') {
                 this.writer.writeUByte(analysis.fileZ);
             }
        }

        // 6. Marker + Extra Info (Only for Z-Sprites)
        this.writeMarker();
        for (const spr of this.sortedSprites) {
             const analysis = this.coordinateService.analyzeSpriteType(this.mapData, spr);
             if (analysis.type === 'z') {
                 this.writer.writeUByte(spr.extraInfo || 0);
             }
        }
    }

    private skipOldScripts() {
        // Read original header to know how much to skip
        const oldNumTileEvents = this.reader.view.getInt16(27, true);
        const oldByteCodeSize = this.reader.view.getInt16(29, true);
        checkedLength(oldNumTileEvents, 8, this.reader.fileName, 'header tile-event count', 27);
        checkedLength(oldByteCodeSize, 1, this.reader.fileName, 'header bytecode size', 29);

        readMarker(this.reader, MAP_MARKER, 'script section'); this.reader.skip(12 * 2); // Static Funcs
        readMarker(this.reader, MAP_MARKER, 'script section'); this.reader.skip(oldNumTileEvents * 8); // Tile Events
        readMarker(this.reader, MAP_MARKER, 'script section'); this.reader.skip(oldByteCodeSize); // Bytecode
    }

    private writeScripts(staticFuncs: number[], tileEvents: Int32Array, bytecode: Uint8Array) {
        // 1. Static Funcs
        this.writeMarker();
        for(let i=0; i<12; i++) this.writer.writeUShort(staticFuncs[i] || 0);

        // 2. Tile Events
        this.writeMarker();
        const numEvents = tileEvents.length / 2;
        for(let i=0; i<numEvents; i++) {
            this.writer.writeInt(tileEvents[i*2]);     // Packed
            this.writer.writeInt(tileEvents[i*2+1]);   // Flags
        }

        // 3. Bytecode
        this.writeMarker();
        this.writer.writeBytes(bytecode);
    }

    private writeMarker() { this.writer.writeInt(-889275714); }

    private validateGeometry() {
        const g = this.mapData.geometry;
        // Compatibility for old callers which only paint textures; structural serialization requires the lossless model.
        if (!g.polygons || !g.sourceVertices || !g.nodes || !g.leaves || !g.normals || !g.lines) return;
        const fits = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
        if (![g.nodes.length, g.leaves.length, g.lines.length, g.normals.length, g.polygons.length, g.sourceVertices.length].every(n => fits(n, 0, 0xffff))) {
            throw new Error('Geometry section count exceeds uint16');
        }
        g.vertices = g.vertices ?? new Float32Array();
        g.uvs = g.uvs ?? new Float32Array();
        g.polygons.forEach((p, i) => {
            if (!fits(p.vertexCount, 2, 9) || !fits(p.vertexStart, 0, g.sourceVertices.length - p.vertexCount)) throw new Error(`Polygon ${i} has an invalid vertex range`);
            if (!fits(packMapTextureId(p.textureId).packedId, 0, 255)) throw new Error(`Polygon ${i} texture ID does not fit uint8`);
        });
        g.sourceVertices.forEach((v, i) => {
            if (![v.x, v.y, v.z].every(n => fits(n, 0, 255)) || ![v.u, v.v].every(n => fits(n, -128, 127))) throw new Error(`Vertex ${i} does not fit the map numeric fields`);
        });
        g.lines.forEach((l, i) => { if (!fits(l.flags, 0, 15) || ![l.x1, l.y1, l.x2, l.y2].every(n => fits(n, 0, 255))) throw new Error(`Collision line ${i} is invalid`); });
        if (g.heightMap.length !== 1024) throw new Error('Heightmap must contain exactly 1024 bytes');
    }


    private copyMarker() {
        const expected = this.copiedMarkerCount++ < 2 ? MAP_FIRST_MARKER : MAP_MARKER;
        readMarker(this.reader, expected, 'map section');
        this.writer.writeInt(expected);
    }

    private copyBytes(len: number) {
        if (len <= 0) return;
        const chunk = this.reader.readByteArray(len);
        this.writer.writeBytes(chunk);
    }
}
