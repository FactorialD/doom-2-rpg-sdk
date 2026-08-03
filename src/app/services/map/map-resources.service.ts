import { Injectable, inject, signal, effect } from '@angular/core';
import * as THREE from 'three';
import { DoomTextureService, TextureInfo } from '../doom-texture.service';
import { SpecialTextureIds } from '../../core/constants/texture-groups';

@Injectable({
  providedIn: 'root'
})
export class MapResourcesService {
  private textureService = inject(DoomTextureService);
  
  private textureCache = new Map<number, THREE.Texture>();
  private materials = new Map<number, THREE.Material>();

  // Special materials
  private skyMaterial: THREE.ShaderMaterial | null = null;
  private skyUniforms = {
      map: { value: null as THREE.Texture | null },
      uYaw: { value: 0 }
  };

  // Global material settings
  cullBackFaces = signal(false);

  constructor() {
    // Update materials when culling changes
    effect(() => {
        const side = this.cullBackFaces() ? THREE.FrontSide : THREE.DoubleSide;
        this.materials.forEach((mat, id) => {
            // Glass always double side
            if (mat.userData['isGlass']) {
                mat.side = THREE.DoubleSide;
            } else {
                mat.side = side;
            }
            mat.needsUpdate = true;
        });
        
        // Ensure Sky is consistent with occlusion needs. 
        // We do NOT change sky side based on global cull setting to ensure it always blocks voids.
    });
  }

  getMaterial(texId: number): THREE.Material {
      // HANDLE SKYBOX
      if (texId === SpecialTextureIds.SKYBOX) {
          return this.getSkyMaterial();
      }

      const texInfo = this.textureService.getTextureByGroup(texId);
      const realId = texInfo ? texInfo.id : -1;
      
      if (this.materials.has(realId)) {
          return this.materials.get(realId)!;
      }
      
      const texture = this.getThreeTexture(realId);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.y = -1; 
      
      let isOpaque = true;
      if (realId !== -1) {
          isOpaque = !this.textureService.isIndex0Transparent(realId);
      }

      const matParams: THREE.MeshBasicMaterialParameters = {
          map: texture,
          transparent: !isOpaque,
          alphaTest: 0.5,
          side: this.cullBackFaces() ? THREE.FrontSide : THREE.DoubleSide
      };
      
      // Special Handling based on Render.java logic
      if (texId === SpecialTextureIds.LIGHT_GLOW || texId === SpecialTextureIds.FIRE || texId === SpecialTextureIds.FIRE_BALL) {
          // Light Glow / Fire -> Additive
          matParams.transparent = true;
          matParams.blending = THREE.AdditiveBlending;
          matParams.depthWrite = false;
      }
      else if (texId === SpecialTextureIds.FADE || texId === SpecialTextureIds.SCORCH) {
          // Fade / Scorch -> Multiply
          matParams.transparent = true;
          matParams.blending = THREE.MultiplyBlending;
          matParams.premultipliedAlpha = true; 
          matParams.depthWrite = false;
      } 
      else if (texId === SpecialTextureIds.GLASS) {
          // Glass -> 50% opacity blend
          matParams.transparent = true;
          matParams.opacity = 0.5;
          matParams.alphaTest = 0; // Disable cutout to allow smooth transparency
          matParams.depthWrite = false; // Glass doesn't block depth
          matParams.side = THREE.DoubleSide; // Visible from both sides
      }
      
      const mat = new THREE.MeshBasicMaterial(matParams);
      if (texId === SpecialTextureIds.GLASS) mat.userData['isGlass'] = true;
      
      if (realId !== -1) this.materials.set(realId, mat);
      return mat;
  }
  
  getSpriteMaterialFromInfo(texInfo: TextureInfo | undefined): THREE.SpriteMaterial {
      const realId = texInfo ? texInfo.id : -1;
      const texture = this.getThreeTexture(realId);
      texture.repeat.y = -1;
      texture.offset.y = 1;
      
      return new THREE.SpriteMaterial({ 
          map: texture, 
          transparent: true, 
          alphaTest: 0.5 
      });
  }

  private getThreeTexture(id: number): THREE.Texture {
      if (this.textureCache.has(id)) return this.textureCache.get(id)!;
      
      const imgData = this.textureService.getTextureImageData(id);
      let tex: THREE.Texture;
      
      if (imgData) {
          tex = new THREE.DataTexture(imgData.data, imgData.width, imgData.height, THREE.RGBAFormat);
          tex.needsUpdate = true;
      } else {
          // Magenta placeholder for missing textures
          const data = new Uint8Array([255, 0, 255, 255]);
          tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
          tex.needsUpdate = true;
      }
      
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.generateMipmaps = false;
      
      this.textureCache.set(id, tex);
      return tex;
  }

  updateSkyUniforms(cameraYaw: number) {
      this.skyUniforms.uYaw.value = cameraYaw;
  }

  private getSkyMaterial(): THREE.Material {
      if (this.skyMaterial) return this.skyMaterial;

      const texture = this.getThreeTexture(SpecialTextureIds.SKYBOX);
      
      // Ensure smooth wrapping for sky
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      
      this.skyUniforms.map.value = texture;

      // Screen-Space Skybox Shader
      const vertexShader = `
          varying vec4 vScreenPos;
          void main() {
              vScreenPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              gl_Position = vScreenPos;
          }
      `;

      const fragmentShader = `
          uniform sampler2D map;
          uniform float uYaw;
          varying vec4 vScreenPos;
          
          void main() {
              vec2 ndc = vScreenPos.xy / vScreenPos.w;
              vec2 uv = ndc * 0.5 + 0.5;
              
              // Parallax factor based on Render.java (768px shift for 360 deg)
              float angleFactor = (uYaw / 6.28318) * 6.0;
              float screenScale = 1.0; 
              
              float u = -angleFactor + uv.x * screenScale;
              
              // Flip V because J2ME maps top-down, OpenGL bottom-up
              float v = 1.0 - uv.y; 
              
              vec4 col = texture2D(map, vec2(u, v));
              
              // Force full opacity to act as a solid wall
              gl_FragColor = vec4(col.rgb, 1.0);
          }
      `;

      this.skyMaterial = new THREE.ShaderMaterial({
          uniforms: this.skyUniforms,
          vertexShader: vertexShader,
          fragmentShader: fragmentShader,
          
          // CRITICAL: DoubleSide ensures we see it even if normals are flipped (common in Doom maps).
          side: THREE.DoubleSide, 
          
          // CRITICAL: Write to depth buffer so geometry behind it fails Z-Test and isn't drawn.
          depthWrite: true, 
          depthTest: true,
          
          // Treat as opaque to ensure it's drawn in the opaque pass (front-to-back sorting).
          transparent: false,
          
          // No blending ensures we overwrite pixels completely.
          blending: THREE.NoBlending,

          // Polygon Offset prevents Z-fighting if the sky wall is coplanar with another wall behind it.
          // This "pulls" the sky slightly towards the camera depth-wise.
          polygonOffset: true,
          polygonOffsetFactor: -2, 
          polygonOffsetUnits: -4
      });

      return this.skyMaterial;
  }

  dispose() {
      this.materials.forEach(m => m.dispose());
      this.materials.clear();
      this.textureCache.forEach(t => t.dispose());
      this.textureCache.clear();
      if (this.skyMaterial) {
          this.skyMaterial.dispose();
          this.skyMaterial = null;
      }
  }
}