import { Injectable } from '@angular/core';
import { TextureGroupIds } from '../../core/constants/texture-groups';

export interface CompositeLayer {
    frameIndex: number;
    renderOrder: number; // 0=Bottom, higher draws on top
}

@Injectable({
  providedIn: 'root'
})
export class SpriteCompositorService {

  constructor() { }

  /**
   * Checks if a texture group ID corresponds to a composite entity (Monster or NPC).
   */
  isComposite(groupId: number): boolean {
      const isMonster = (groupId >= TextureGroupIds.MONSTER_START && groupId <= TextureGroupIds.MONSTER_END);
      const isNPC = (groupId >= TextureGroupIds.NPC_START && groupId <= TextureGroupIds.NPC_END);
      return isMonster || isNPC;
  }

  /**
   * Returns the list of frame indices and their render order to compose the sprite.
   * @param groupId The texture group ID of the entity.
   * @param selectedFrameIndex The frame index currently selected (e.g., from Texture Viewer). Pass -1 for default idle state.
   */
  getCompositeLayers(groupId: number, selectedFrameIndex: number = -1): CompositeLayer[] {
      // If not a composite entity, just return the requested frame (or 0 if default)
      if (!this.isComposite(groupId)) {
          return [{ frameIndex: selectedFrameIndex === -1 ? 0 : selectedFrameIndex, renderOrder: 0 }];
      }

      // --- Default Idle State (Front) ---
      // Legs(0), Torso(2), Head(3)
      if (selectedFrameIndex === -1) {
          return [
              { frameIndex: 0, renderOrder: 0 },
              { frameIndex: 2, renderOrder: 1 },
              { frameIndex: 3, renderOrder: 2 }
          ];
      }

      // --- Context-Aware Composition ---
      
      // Front View (Frames 0-3)
      // 0,1: Legs | 2: Torso | 3: Head
      if (selectedFrameIndex >= 0 && selectedFrameIndex <= 3) {
          const layers = [
              { frameIndex: 0, renderOrder: 0 }, // Legs base
              { frameIndex: 2, renderOrder: 1 }, // Torso base
              { frameIndex: 3, renderOrder: 2 }  // Head base
          ];
          
          // Override specific part based on selection to show animation
          if (selectedFrameIndex <= 1) layers[0].frameIndex = selectedFrameIndex;
          else if (selectedFrameIndex === 2) layers[1].frameIndex = selectedFrameIndex;
          else if (selectedFrameIndex === 3) layers[2].frameIndex = selectedFrameIndex;
          
          return layers;
      }
      
      // Back View (Frames 4-7)
      // 4,5: Back Legs | 6: Back Torso | 7: Back Head
      if (selectedFrameIndex >= 4 && selectedFrameIndex <= 7) {
          const layers = [
              { frameIndex: 4, renderOrder: 0 }, // Back Legs base
              { frameIndex: 6, renderOrder: 1 }, // Back Torso base
              { frameIndex: 7, renderOrder: 2 }  // Back Head base
          ];
          
          if (selectedFrameIndex <= 5) layers[0].frameIndex = selectedFrameIndex;
          else if (selectedFrameIndex === 6) layers[1].frameIndex = selectedFrameIndex;
          else if (selectedFrameIndex === 7) layers[2].frameIndex = selectedFrameIndex;
          
          return layers;
      }

      // Attack Animations (Frames 8-11)
      // Attacks typically replace the Torso AND include the Head in the sprite.
      // We keep the legs (0) but remove the separate head layer.
      // 8: Idle->Atk1, 9: Atk1, 10: Idle->Atk2, 11: Atk2
      if (selectedFrameIndex >= 8 && selectedFrameIndex <= 11) {
          return [
              { frameIndex: 0, renderOrder: 0 }, // Legs
              { frameIndex: selectedFrameIndex, renderOrder: 1 } // Attack Body (Torso+Head)
          ];
      }

      // Pain/Death/Special (Frames 12+)
      // These are usually full-body sprites in Doom RPG J2ME
      return [{ frameIndex: selectedFrameIndex, renderOrder: 0 }];
  }
}