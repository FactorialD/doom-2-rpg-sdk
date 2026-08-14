
import { Injectable } from '@angular/core';
import { MapData, MapSprite } from '../doom-map.service';
import * as THREE from 'three';

@Injectable({ providedIn: 'root' })
export class MapCoordinateService {
    
    // Scale factor: 16 Game Units = 1 pixel in WebGL View (approx)
    // Actually GeometryScale.SPRITE is 16.0.
    private readonly SCALE = 16.0;

    /**
     * Converts Game Coordinates (Doom RPG) to 3D World Coordinates (Three.js)
     */
    gameToWorld(gx: number, gy: number, gz: number): THREE.Vector3 {
        // MapSprite.x = Game X.
        // MapSprite.y = Game Height (Z in Doom).
        // MapSprite.z = Game Depth (Y in Doom).
        
        return new THREE.Vector3(
            gx * this.SCALE,
            gy * this.SCALE,
            gz * this.SCALE
        );
    }

    /**
     * Converts 3D World Coordinates to Game Coordinates with grid snapping
     */
    worldToGame(vec: THREE.Vector3): { x: number, y: number, z: number } {
        return {
            x: this.snapToGrid(vec.x / this.SCALE),
            y: this.snapToGrid(vec.y / this.SCALE), // Height
            z: this.snapToGrid(vec.z / this.SCALE)  // Depth
        };
    }

    /**
     * Quantizes a value to the 8-unit grid used by the binary format.
     */
    snapToGrid(val: number): number {
        return Math.round(val / 8) * 8;
    }

    /**
     * Gets the floor height at a specific game coordinate.
     * Replicates Render.java getHeight logic.
     */
    getFloorHeight(mapData: MapData, gameX: number, gameZ: number): number {
        const gridX = gameX >> 6; // x / 64
        const gridY = gameZ >> 6; // y / 64
        
        if (gridX >= 0 && gridX < 32 && gridY >= 0 && gridY < 32) {
             const idx = (gridY * 32) + gridX;
             // Heightmap stores height in units of 8.
             // Render.java: return var2[...] << 3;
             return mapData.heightMap[idx] << 3;
        }
        return 0;
    }

    /**
     * Calculates the file-storage Z value for a sprite.
     * Determines if sprite should be 'normal' or 'z-type' based on its height relative to floor.
     */
    analyzeSpriteType(mapData: MapData, sprite: MapSprite): { type: 'normal' | 'z', fileZ: number } {
        const floor = this.getFloorHeight(mapData, sprite.x, sprite.z);
        
        // Standard "Ground" height is Floor + 32.
        // If sprite is exactly at this height, it's a Normal sprite (saves space in file).
        if (sprite.y === floor + 32) {
            return { type: 'normal', fileZ: 0 };
        }
        
        // Otherwise, it's a Z-Sprite (flying, floating, or sunk).
        // Formula: Z_game = FileZ + Floor - 32
        // Therefore: FileZ = Z_game - Floor + 32
        const fileZ = sprite.y - floor + 32;
        if (!Number.isInteger(fileZ) || fileZ < 0 || fileZ > 255) {
            throw new RangeError(`Z-sprite height ${sprite.y} produces file Z ${fileZ}; expected an unsigned byte`);
        }
        
        return { type: 'z', fileZ };
    }
}
