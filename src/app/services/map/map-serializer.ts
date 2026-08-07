import { Injectable, inject } from '@angular/core';
import { MapData, MapSprite } from '../doom-map.service';
import { ByteStream, BinaryWriter, MAP_FIRST_MARKER, MAP_MARKER, checkedLength, readMarker } from '../../utils/byte-stream';
import { SpecialTextureIds, TextureGroupIds } from '../../core/constants/texture-groups';
import { SpriteFlag } from '../../core/constants/map-flags';
import { PolyFlag } from '../../core/constants/geometry';
import { MapCoordinateService } from './map-coordinate.service';
import { DoomScriptService } from '../doom-script.service';
import { ScriptCompilerService } from '../scripts/script-compiler.service';
import { MapValidationService } from './map-validation.service';

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
                console.warn("MapSerializer: Some script entity references were broken.");
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

        const head_numNodes = this.reader.readUShort(); this.writer.writeUShort(head_numNodes);
        const head_numLeaf = this.reader.readUShort(); this.writer.writeUShort(head_numLeaf);
        this.head_numLines = this.reader.readUShort(); this.writer.writeUShort(this.head_numLines);
        const head_numNormals = this.reader.readUShort(); this.writer.writeUShort(head_numNormals);
        this.head_numPolys = this.reader.readUShort(); this.writer.writeUShort(this.head_numPolys);
        const head_numVerts = this.reader.readUShort(); this.writer.writeUShort(head_numVerts);

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
        const peekReader = this.reader.createReader();
        peekReader.position = 11;
        const numNodes = peekReader.readUShort();
        const numLeaf = peekReader.readUShort();
        peekReader.readUShort(); // lines
        const numNormals = peekReader.readUShort();

        this.copyMarker();
        this.copyBytes(numNormals * 3 * 2);

        this.copyMarker(); this.copyBytes(numNodes * 2);
        this.copyMarker(); this.copyBytes(numNodes);
        this.copyMarker(); this.copyBytes(numNodes * 2); this.copyBytes(numNodes * 2);
        this.copyMarker(); this.copyBytes(numNodes * 2); this.copyBytes(numNodes * 2);

        this.copyMarker(); this.copyBytes(numLeaf * 2); this.copyBytes(numLeaf * 2);
    }

    private writePolygons() {
        this.copyMarker();

        this.reader.skip(this.head_numPolys);

        for (let i = 0; i < this.head_numPolys; i++) {
            let tid = this.mapData.geometry.textureIds[i] || 0;
            if (tid >= SpecialTextureIds.WALL_OFFSET) tid -= SpecialTextureIds.WALL_OFFSET;
            this.writer.writeUByte(tid);
        }

        this.reader.skip(this.head_numPolys);

        for (let i = 0; i < this.head_numPolys; i++) {
            let flags = this.mapData.geometry.flags[i] || 0;
            const tid = this.mapData.geometry.textureIds[i];

            if (tid >= SpecialTextureIds.WALL_OFFSET) {
                flags |= PolyFlag.WallTexture;
            } else {
                flags &= ~PolyFlag.WallTexture;
            }
            this.writer.writeUByte(flags);
        }

        const peekReader = this.reader.createReader();
        peekReader.position = 21;
        const numVerts = peekReader.readUShort();

        this.copyBytes(numVerts * 5);
    }

    private writeBSPAndHeightmap() {
        this.copyMarker();
        this.copyBytes(Math.floor((this.head_numLines + 1) / 2));
        this.copyBytes(this.head_numLines * 2);
        this.copyBytes(this.head_numLines * 2);

        this.copyMarker();
        this.copyBytes(1024);
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
            let tid = spr.textureId;
            let flagVal = spr.flags;

            if (tid >= SpecialTextureIds.WALL_OFFSET) {
                flagVal |= SpriteFlag.Wall;
                tid -= SpecialTextureIds.WALL_OFFSET;
            } else {
                flagVal &= ~SpriteFlag.Wall;
            }

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
