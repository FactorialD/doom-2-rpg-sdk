
import { computed, Injectable, signal } from '@angular/core';

export type EditorTab = 'map' | 'textures' | 'images' | 'text' | 'scripts' | 'palettes' | 'items' | 'variables' | 'sounds';

export interface NavigationRequest { requestId: number; externalNavigation: true; }
export interface EntitySelection extends NavigationRequest {
    mapId: number;
    entityId: number; // Sprite Index
    fromScript?: boolean; // Context flag
}

export interface ScriptNavigation extends NavigationRequest {
    mapId: number;
    offset: number;
}

export interface TextNavigation extends NavigationRequest {
    chunkId: number;
    stringId: number;
}

export type EditableResource = 'maps' | 'scripts' | 'textures' | 'images' | 'palettes' | 'strings';
export type ResourceId = string | number;
export interface DirtyResource { dirty: boolean; resourceId: ResourceId | null; }
export interface EditorMessage { type: 'success' | 'error'; text: string; }

const cleanState = (): Record<EditableResource, DirtyResource> => ({
  maps: { dirty: false, resourceId: null }, scripts: { dirty: false, resourceId: null },
  textures: { dirty: false, resourceId: null }, palettes: { dirty: false, resourceId: null },
  strings: { dirty: false, resourceId: null }, images: { dirty: false, resourceId: null }
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
  requestedTextureSelection = signal<(NavigationRequest & { textureId: number }) | null>(null);

  // Signal to jump to a specific script offset
  requestedScriptNavigation = signal<ScriptNavigation | null>(null);

  // Signal to request opening a palette
  requestedPaletteSelection = signal<(NavigationRequest & { paletteId: number }) | null>(null);

  // Signal to jump to a specific string
  requestedTextNavigation = signal<TextNavigation | null>(null);
  
  // Notification signal when scripts are modified (e.g. by Map Editor)
  scriptsUpdated = signal<number>(0);
  textResourcesUpdated = signal<number>(0);
  readonly dirtyResources = signal(cleanState());
  readonly hasUnsavedChanges = computed(() => Object.values(this.dirtyResources()).some(value => value.dirty));
  readonly message = signal<EditorMessage | null>(null);
  private nextRequestId = 0;

  private request(): NavigationRequest {
    return { requestId: ++this.nextRequestId, externalNavigation: true };
  }

  private expireNavigation<T extends NavigationRequest>(target: { (): T | null; set(value: T | null): void }, request: T, label: string) {
    setTimeout(() => {
      if (target()?.requestId !== request.requestId) return;
      target.set(null);
      this.notify('error', `${label} was not found before navigation timed out.`);
    }, 8000);
  }

  acknowledgeNavigation<T extends NavigationRequest>(target: { (): T | null; set(value: T | null): void }, requestId: number) {
    if (target()?.requestId === requestId) target.set(null);
  }

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
      const request = { ...this.request(), mapId, entityId, fromScript };
      this.activeTab.set('map');
      this.requestedEntitySelection.set(request);
      this.expireNavigation(this.requestedEntitySelection, request, `Entity #${entityId}`);
  }

  selectTexture(textureId: number) {
      // Set both the navigation request AND the current brush
      this.currentTextureId.set(textureId);
      const request = { ...this.request(), textureId };
      this.activeTab.set('textures');
      this.requestedTextureSelection.set(request);
      this.expireNavigation(this.requestedTextureSelection, request, `Texture #${textureId}`);
  }

  goToScript(mapId: number, offset: number) {
      const request = { ...this.request(), mapId, offset };
      this.activeTab.set('scripts');
      this.requestedScriptNavigation.set(request);
      this.expireNavigation(this.requestedScriptNavigation, request, `Instruction 0x${offset.toString(16).toUpperCase()}`);
  }

  selectPalette(paletteId: number) {
      const request = { ...this.request(), paletteId };
      this.activeTab.set('palettes');
      this.requestedPaletteSelection.set(request);
      this.expireNavigation(this.requestedPaletteSelection, request, `Palette #${paletteId}`);
  }

  goToString(chunkId: number, stringId: number) {
      const request = { ...this.request(), chunkId, stringId };
      this.activeTab.set('text');
      this.requestedTextNavigation.set(request);
      this.expireNavigation(this.requestedTextNavigation, request, `String #${stringId}`);
  }
  
  notifyScriptsChanged() {
      this.scriptsUpdated.update(n => n + 1);
  }

  notifyTextResourceChanged() {
      this.textResourcesUpdated.update(n => n + 1);
  }
}
