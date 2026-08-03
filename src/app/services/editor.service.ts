
import { Injectable, signal } from '@angular/core';

export type EditorTab = 'map' | 'textures' | 'text' | 'scripts' | 'palettes' | 'items' | 'variables';

export interface EntitySelection {
    mapId: number;
    entityId: number; // Sprite Index
    fromScript?: boolean; // Context flag
}

export interface ScriptNavigation {
    mapId: number;
    offset: number;
}

export interface TextNavigation {
    chunkId: number;
    stringId: number;
}

@Injectable({
  providedIn: 'root'
})
export class EditorService {
  activeTab = signal<EditorTab>('text'); 
  
  // The texture currently selected in the Texture Viewer (acting as a "Clipboard" or "Brush")
  currentTextureId = signal<number>(1);
  
  // Signal to request focusing on a specific entity in the Map View
  requestedEntitySelection = signal<EntitySelection | null>(null);

  // Signal to request opening a texture (Navigation)
  requestedTextureSelection = signal<number | null>(null);

  // Signal to jump to a specific script offset
  requestedScriptNavigation = signal<ScriptNavigation | null>(null);

  // Signal to request opening a palette
  requestedPaletteSelection = signal<number | null>(null);

  // Signal to jump to a specific string
  requestedTextNavigation = signal<TextNavigation | null>(null);
  
  // Notification signal when scripts are modified (e.g. by Map Editor)
  scriptsUpdated = signal<number>(0);

  selectMapEntity(mapId: number, entityId: number, fromScript: boolean = false) {
      this.requestedEntitySelection.set({ mapId, entityId, fromScript });
      this.activeTab.set('map');
  }

  selectTexture(textureId: number) {
      // Set both the navigation request AND the current brush
      this.currentTextureId.set(textureId);
      this.requestedTextureSelection.set(textureId);
      this.activeTab.set('textures');
  }

  goToScript(mapId: number, offset: number) {
      this.requestedScriptNavigation.set({ mapId, offset });
      this.activeTab.set('scripts');
  }

  selectPalette(paletteId: number) {
      this.requestedPaletteSelection.set(paletteId);
      this.activeTab.set('palettes');
  }

  goToString(chunkId: number, stringId: number) {
      this.requestedTextNavigation.set({ chunkId, stringId });
      this.activeTab.set('text');
  }
  
  notifyScriptsChanged() {
      this.scriptsUpdated.update(n => n + 1);
  }
}
