import { Injectable, inject, signal, effect } from '@angular/core';
import * as THREE from 'three';
import { MapData } from '../doom-map.service';
import { DoomTextureService } from '../doom-texture.service';
import { MapResourcesService } from './map-resources.service';
import { SpriteFlag } from '../../core/constants/map-flags';
import { SpecialTextureIds } from '../../core/constants/texture-groups';
import { SpriteCompositorService } from '../textures/sprite-compositor.service';

@Injectable({
  providedIn: 'root'
})
export class MapEntityBuilder {
  private textureService = inject(DoomTextureService);
  private resources = inject(MapResourcesService);
  private compositor = inject(SpriteCompositorService);

  private objects: THREE.Object3D[] = [];
  
  // Quick lookup from Sprite Index (File Order) to 3D Object
  private entityMap = new Map<number, THREE.Object3D>();

  showSprites = signal(true);

  constructor() {
      effect(() => {
          const visible = this.showSprites();
          this.objects.forEach(obj => obj.visible = visible);
      });
  }

  build(scene: THREE.Scene, data: MapData) {
      this.clear(scene);

      // Visual scale to match Geometry (GameUnit * 16 = WorldUnit 128-base)
      const S = 16.0;

      data.sprites.forEach((spr, index) => {
           if (isNaN(spr.x) || isNaN(spr.y) || isNaN(spr.z)) return;

           const isOriented = (spr.flags & (SpriteFlag.OrientationNorthBit | SpriteFlag.OrientationSouthBit | SpriteFlag.OrientationEastBit | SpriteFlag.OrientationWestBit | SpriteFlag.Flat | SpriteFlag.Wall)) !== 0;
           
           let obj: THREE.Object3D | null = null;

           if (this.compositor.isComposite(spr.textureId)) {
               // Composite Sprites (Monsters/NPCs)
               const group = new THREE.Group();
               // Apply scale to position
               group.position.set(spr.x * S, spr.y * S, spr.z * S);
               
               // Get default layers (Idle state)
               const layers = this.compositor.getCompositeLayers(spr.textureId, -1);
               
               // Render base order for parts
               const BASE_ORDER = 10;

               layers.forEach(layer => {
                   const texInfo = this.textureService.getTextureFrame(spr.textureId, layer.frameIndex);
                   if (!texInfo) return;
                   
                   const mat = this.resources.getSpriteMaterialFromInfo(texInfo);
                   mat.depthTest = true; 
                   
                   const sprite = new THREE.Sprite(mat);
                   // Apply small offset to renderOrder to handle layering within the sprite
                   sprite.renderOrder = BASE_ORDER + layer.renderOrder;
                   
                   const w = texInfo.width * S;
                   const h = texInfo.height * S;
                   
                   sprite.scale.set(w, h, 1);
                   sprite.center.set(0.5, 0.5); 
                   group.add(sprite);
               });
               
               scene.add(group);
               this.objects.push(group);
               obj = group;
           } 
           else if (isOriented) {
               // Oriented Planes (fake 3D walls/decals)
               const texInfo = this.textureService.getTextureByGroup(spr.textureId);
               const w = texInfo ? texInfo.width * S : 256;
               const h = texInfo ? texInfo.height * S : 256;

               const geometry = new THREE.PlaneGeometry(1, 1);
               const mat = this.resources.getMaterial(spr.textureId); 
               
               const mesh = new THREE.Mesh(geometry, mat);
               
               const WALL_OFFSET = 2.0;
               let xOff = 0, zOff = 0;

               if (spr.flags & SpriteFlag.OrientationNorthBit) { mesh.rotation.y = Math.PI; zOff = -WALL_OFFSET; }
               else if (spr.flags & SpriteFlag.OrientationSouthBit) { mesh.rotation.y = 0; zOff = WALL_OFFSET; }
               else if (spr.flags & SpriteFlag.OrientationEastBit) { mesh.rotation.y = -Math.PI / 2; xOff = WALL_OFFSET; }
               else if (spr.flags & SpriteFlag.OrientationWestBit) { mesh.rotation.y = Math.PI / 2; xOff = -WALL_OFFSET; }
               else if (spr.flags & SpriteFlag.Wall) { mesh.rotation.y = 0; }

               if (spr.flags & SpriteFlag.Flat) {
                   mesh.rotation.x = -Math.PI / 2; 
                   // Apply scale
                   mesh.position.set(spr.x * S, spr.y * S, spr.z * S); 
               } else {
                   mesh.position.set(spr.x * S + xOff, spr.y * S, spr.z * S + zOff);
               }

               mesh.scale.set(w, h, 1);
               scene.add(mesh);
               this.objects.push(mesh);
               obj = mesh;
           } 
           else {
               // Standard Billboard Sprite
               let texInfo = this.textureService.getTextureByGroup(spr.textureId);
               
               if (spr.textureId >= 1 && spr.textureId < 14) {
                   const worldSpriteFrame = this.textureService.getTextureFrame(spr.textureId, 2);
                   if (worldSpriteFrame) {
                       texInfo = worldSpriteFrame;
                   }
               }
               
               const w = texInfo ? texInfo.width * S : 256;
               const h = texInfo ? texInfo.height * S : 256;

               const mat = this.resources.getSpriteMaterialFromInfo(texInfo);
               
               // Render.java special handling for additive sprites
               const isAdditive = (spr.textureId === SpecialTextureIds.LIGHT_GLOW || (spr.textureId >= 240 && spr.textureId <= 244));
               if (isAdditive) {
                   mat.blending = THREE.AdditiveBlending;
                   mat.depthWrite = false;
               }

               const sprite = new THREE.Sprite(mat);
               
               // yPos is in Game Units initially
               let yPos = spr.y;
               if (spr.type === 'normal') {
                    // Logic needs World Units for offsets
                    const logicalHeight = 64.0 * S;
                    const actualHeight = h; // Already scaled
                    const yOffset = (actualHeight / 2) - (logicalHeight / 2);
                    
                    // We can't add scaled offset to game unit yPos yet.
                    // Convert yPos to world for calculation, or keep it separate.
                    // Let's do: Position = (spr.y * S) + offset
                    yPos = spr.y * S + yOffset;
                    
                    if (texInfo && texInfo.bounds) {
                        const bottomPadding = texInfo.height - texInfo.bounds.maxY;
                        if (bottomPadding > 0) {
                            yPos -= bottomPadding * S;
                        }
                    }
               } else {
                   yPos = spr.y * S;
               }

               sprite.position.set(spr.x * S, yPos, spr.z * S); 
               sprite.scale.set(w, h, 1);
               sprite.center.set(0.5, 0.5); 
               
               if ((spr.flags & 2) !== 0) sprite.scale.x *= -1; 
               
               scene.add(sprite);
               this.objects.push(sprite);
               obj = sprite;
           }

           // Map sprite index to object for external selection
           if (obj) {
               obj.userData['entityId'] = index;
               this.entityMap.set(index, obj);
           }
      });
      
      const visible = this.showSprites();
      this.objects.forEach(obj => obj.visible = visible);
  }
  
  getObjectByEntityId(id: number): THREE.Object3D | undefined {
      return this.entityMap.get(id);
  }

  clear(scene: THREE.Scene) {
      this.objects.forEach(s => {
          scene.remove(s);
          if (s instanceof THREE.Group) s.clear();
          if (s instanceof THREE.Mesh) s.geometry.dispose();
      });
      this.objects = [];
      this.entityMap.clear();
  }
}
