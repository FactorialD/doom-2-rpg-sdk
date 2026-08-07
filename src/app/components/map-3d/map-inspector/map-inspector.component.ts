import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { EditorService } from '../../../services/editor.service';
import { TextureInfo } from '../../../services/doom-texture.service';
import { EntityDef } from '../../../services/doom-entities.service';
import { MapSprite } from '../../../services/doom-map.service';
import { ScriptData } from '../../../services/doom-script.service';

import { MapEntityPropertiesComponent } from './map-entity-properties.component';
import { MapGeometryPropertiesComponent } from './map-geometry-properties.component';
import { MapScriptLinkerComponent } from './map-script-linker.component';

export interface EntityDetails {
    spriteIndex: number;
    raw: MapSprite;
    texture?: TextureInfo;
    entityDef?: EntityDef;
    flagsDecoded: string[];
}

export interface GeometrySelection {
    polyIndex: number;
    textureId: number; 
    displayTextureId: number; 
    flags: number;
    point?: any; // THREE.Vector3
}

export type EditMode = 'select' | 'paint';

@Component({
  selector: 'app-map-inspector',
  standalone: true,
  imports: [
      CommonModule, 
      TextureThumbnailComponent,
      MapEntityPropertiesComponent,
      MapGeometryPropertiesComponent,
      MapScriptLinkerComponent
  ],
  template: `
    <div class="h-full overflow-y-auto custom-scrollbar p-4 text-xs font-mono text-neutral-300">
        
        <!-- Texture Paint Selector -->
        @if (editMode() === 'paint') {
            <div class="mb-4 bg-neutral-800 p-2 rounded border border-neutral-700">
               <div class="text-[10px] font-bold text-neutral-400 uppercase mb-1">Active Texture Brush</div>
               <div class="flex items-center gap-2">
                  <div class="w-10 h-10 bg-black border border-neutral-600 shrink-0">
                       <app-texture-thumbnail [id]="currentTextureId()" />
                  </div>
                  <div>
                      <div class="text-white font-bold">#{{ currentTextureId() }}</div>
                      <button (click)="editorService.selectTexture(currentTextureId())" class="text-blue-400 text-[10px] hover:underline">Change in Viewer...</button>
                  </div>
               </div>
               <p class="mt-2 text-[10px] text-neutral-500">Go to Textures tab to pick a different texture.</p>
            </div>
        }
        
        <!-- SELECTION INSPECTOR -->
        @if (entityDetails(); as info) {
            
            <app-map-entity-properties 
                [data]="info"
                (entityUpdated)="entityUpdated.emit()"
                (deleteEntity)="deleteEntity.emit()"
                (swapEntityId)="swapEntityId.emit()"
            />
            
            <app-map-script-linker 
                [data]="info"
                [scriptData]="scriptData()"
                (jumpToScript)="jumpToScript.emit($event)"
                (eventsChanged)="eventsChanged.emit($event)"
            />

        } @else if (geometryDetails(); as poly) {
            
            <app-map-geometry-properties 
                [data]="poly"
                [activeBrushId]="currentTextureId()"
                (setTexture)="setTextureForPoly.emit($event)"
            />

        } @else {
            <div class="flex flex-col items-center justify-center h-full text-neutral-500 space-y-2">
                <span class="text-4xl opacity-20">🖱️</span>
                <p>Select an object or wall.</p>
            </div>
        }
    </div>
  `
})
export class MapInspectorComponent {
    editorService = inject(EditorService);
    
    currentTextureId = this.editorService.currentTextureId;
    
    // Inputs
    editMode = input<EditMode>('select');
    entityDetails = input<EntityDetails | null>(null);
    geometryDetails = input<GeometrySelection | null>(null);
    
    // Script context
    scriptData = input<ScriptData | null>(null);
    
    // Outputs
    setTextureForPoly = output<{polyIndex: number, texId: number}>();
    entityUpdated = output<void>();
    deleteEntity = output<void>();
    swapEntityId = output<void>();
    
    // Navigation Output
    jumpToScript = output<string>(); // Target UID
    eventsChanged = output<number>();
}
