
import { Injectable, inject, signal, effect } from '@angular/core';
import * as THREE from 'three';
import { MapData } from '../doom-map.service';
import { DoomTextureService } from '../doom-texture.service';
import { MapResourcesService } from './map-resources.service';

@Injectable({
  providedIn: 'root'
})
export class MapGeometryBuilder {
  private textureService = inject(DoomTextureService);
  private resources = inject(MapResourcesService);

  private meshes: THREE.Mesh[] = [];
  
  // Visibility Signals
  showWalls = signal(true);
  showFlats = signal(true);

  constructor() {
      effect(() => {
          this.updateVisibility();
      });
  }

  build(scene: THREE.Scene, data: MapData) {
      this.clear(scene);
      
      // We group by TextureID to minimize draw calls, but we also need to store
      // which logical polygon (index in poly arrays) each face corresponds to.
      const textureGroups = new Map<number, {
          pos: number[], 
          uv: number[], 
          polyIndices: number[] // Store logical index per vertex/face
      }>();

      const geom = data.geometry;
      let globalVertIdx = 0;
      
      for (let p = 0; p < geom.polyVertexCounts.length; p++) {
          const vCount = geom.polyVertexCounts[p];
          const texId = geom.textureIds[p];
          
          if (!textureGroups.has(texId)) {
              textureGroups.set(texId, { pos: [], uv: [], polyIndices: [] });
          }
          const group = textureGroups.get(texId)!;
          
          const texInfo = this.textureService.getTextureByGroup(texId);
          const texWidth = (texInfo && texInfo.width > 0) ? texInfo.width : 64;
          const texHeight = (texInfo && texInfo.height > 0) ? texInfo.height : 64;

          const firstV = globalVertIdx;
          // Triangulate the polygon (fan)
          for (let v = 2; v < vCount; v++) {
               const idxA = firstV;
               const idxB = firstV + v - 1;
               const idxC = firstV + v;
               
               const pushVert = (idx: number) => {
                   const vx = geom.vertices[idx*3] || 0;
                   const vy = geom.vertices[idx*3+1] || 0;
                   const vz = geom.vertices[idx*3+2] || 0;
                   group.pos.push(vx, vy, vz);
                   
                   const u = geom.uvs[idx*2] || 0;
                   const vCoord = geom.uvs[idx*2+1] || 0;
                   
                   const normU = (u * 4.0) / texWidth;
                   const normV = (vCoord * 4.0) / texHeight;
                   group.uv.push(normU, normV);
                   
                   // CRITICAL: Track which map polygon this vertex belongs to
                   group.polyIndices.push(p);
               };
               
               pushVert(idxA);
               pushVert(idxB);
               pushVert(idxC);
          }
          globalVertIdx += vCount;
      }
      
      textureGroups.forEach((buffers, texId) => {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.pos, 3));
          geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uv, 2));
          
          // Store polygon indices as a custom attribute (size 1) so we can retrieve it after raycasting
          // This allows us to know: "Face #50 clicked -> Polygon #102 in map file"
          geometry.setAttribute('polyIndex', new THREE.Float32BufferAttribute(buffers.polyIndices, 1));
          
          geometry.computeVertexNormals();
          
          const mat = this.resources.getMaterial(texId);
          const mesh = new THREE.Mesh(geometry, mat);
          
          // Determine logical category for toggling visibility
          const texInfo = this.textureService.getTextureByGroup(texId);
          let isWall = true;
          let isFlat = false;
          if (texInfo) {
              if (texInfo.category === 'Flats') { isFlat = true; isWall = false; }
          }
          
          // Special handling for Skybox (ID 301)
          if (texId === 301) {
              mesh.renderOrder = 999; 
          }
          
          mesh.userData['isWall'] = isWall;
          mesh.userData['isFlat'] = isFlat;
          // Tag mesh for raycasting identification
          mesh.userData['isGeometry'] = true;
          
          scene.add(mesh);
          this.meshes.push(mesh);
      });

      this.updateVisibility();
  }

  private updateVisibility() {
      const showWalls = this.showWalls();
      const showFlats = this.showFlats();

      this.meshes.forEach(mesh => {
          if (mesh.userData['isWall']) {
              mesh.visible = showWalls;
          } else if (mesh.userData['isFlat']) {
              mesh.visible = showFlats;
          }
      });
  }

  clear(scene: THREE.Scene) {
      this.meshes.forEach(m => {
        scene.remove(m);
        if (m.geometry) m.geometry.dispose();
      });
      this.meshes = [];
  }
}
