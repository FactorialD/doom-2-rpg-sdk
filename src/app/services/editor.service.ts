
import { computed, Injectable, signal } from '@angular/core';

export type EditorTab = 'map' | 'textures' | 'text' | 'scripts' | 'palettes' | 'items' | 'variables' | 'sounds';

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

export type EditableResource = 'maps' | 'scripts' | 'textures' | 'palettes' | 'strings';
export type ResourceId = string | number;
export interface DirtyResource { dirty: boolean; resourceId: ResourceId | null; }
export interface EditorMessage { type: 'success' | 'error'; text: string; }

const cleanState = (): Record<EditableResource, DirtyResource> => ({
  maps: { dirty: false, resourceId: null }, scripts: { dirty: false, resourceId: null },
  textures: { dirty: false, resourceId: null }, palettes: { dirty: false, resourceId: null },
  strings: { dirty: false, resourceId: null }
});

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
  readonly dirtyResources = signal(cleanState());
  readonly hasUnsavedChanges = computed(() => Object.values(this.dirtyResources()).some(value => value.dirty));
  readonly message = signal<EditorMessage | null>(null);

  markDirty(editor: EditableResource, resourceId: ResourceId) {
    if (this.isDirty(editor, resourceId)) return;
    this.dirtyResources.update(state => ({ ...state, [editor]: { dirty: true, resourceId } }));
  }

  clearDirty(editor: EditableResource, resourceId?: ResourceId) {
    this.dirtyResources.update(state => {
      const current = state[editor];
      if (resourceId !== undefined && current.resourceId !== resourceId) return state;
      return { ...state, [editor]: { dirty: false, resourceId: null } };
    });
  }

  clearAllDirty() { this.dirtyResources.set(cleanState()); }
  isDirty(editor: EditableResource, resourceId?: ResourceId) {
    const state = this.dirtyResources()[editor];
    return state.dirty && (resourceId === undefined || state.resourceId === resourceId);
  }

  confirmResourceChange(editor: EditableResource, nextId: ResourceId, confirmFn = window.confirm.bind(window)): boolean {
    const current = this.dirtyResources()[editor];
    if (!current.dirty || current.resourceId === nextId) return true;
    if (!confirmFn(`You have unsaved ${editor} changes for ${current.resourceId}. Discard them?`)) return false;
    this.clearDirty(editor);
    return true;
  }

  notify(type: EditorMessage['type'], text: string) {
    this.message.set({ type, text });
  }

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
