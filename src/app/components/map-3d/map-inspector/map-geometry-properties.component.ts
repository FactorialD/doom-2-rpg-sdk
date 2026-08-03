import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeometrySelection } from './map-inspector.component';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { EditorService } from '../../../services/editor.service';

@Component({
  selector: 'app-map-geometry-properties',
  standalone: true,
  imports: [CommonModule, TextureThumbnailComponent],
  template: `
    @if (data(); as poly) {
        <!-- GEOMETRY HEADER -->
        <div class="mb-4 bg-neutral-950 border border-neutral-800 rounded p-2">
            <div class="text-white font-bold text-sm mb-1">Polygon #{{ poly.polyIndex }}</div>
            <div class="text-neutral-500 text-[10px]">Geometry Face</div>
        </div>
        
        <div class="space-y-4">
             <!-- Texture -->
            <div>
                <div class="text-neutral-500 font-bold uppercase mb-1 text-[10px]">Texture</div>
                <div class="flex gap-2 bg-neutral-950 p-2 rounded border border-neutral-800">
                    <div class="w-12 h-12 bg-black shrink-0 border border-neutral-800 cursor-pointer hover:border-white transition-colors"
                         (click)="goToTexture(poly.displayTextureId)">
                       <app-texture-thumbnail [id]="poly.displayTextureId" />
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-white font-bold">Group: {{ poly.textureId }}</div>
                        <div class="text-neutral-500 text-[10px]">Flat: {{ poly.displayTextureId }}</div>
                        <button (click)="goToTexture(poly.displayTextureId)" class="text-blue-400 hover:text-white text-[10px] mt-1">View Texture</button>
                    </div>
                </div>
                
                <div class="mt-2 grid grid-cols-2 gap-2">
                    <button (click)="setTexture.emit({polyIndex: poly.polyIndex, texId: activeBrushId()})" class="bg-neutral-800 hover:bg-neutral-700 text-white py-1 rounded border border-neutral-600 text-[10px]">
                        Apply Brush (#{{ activeBrushId() }})
                    </button>
                </div>
            </div>
            
            <!-- Flags -->
            <div>
                <div class="text-neutral-500 font-bold uppercase mb-1 text-[10px]">Flags ({{ poly.flags }})</div>
                <div class="text-[10px] text-neutral-400 bg-neutral-950 p-2 rounded border border-neutral-800">
                    Hex: 0x{{ poly.flags.toString(16).toUpperCase() }}
                    @if (hasWallTextureFlag(poly.flags)) {
                        <span class="block text-green-400 mt-1">WALL_TEXTURE (32)</span>
                    }
                </div>
            </div>
        </div>
    }
  `
})
export class MapGeometryPropertiesComponent {
    data = input<GeometrySelection | null>(null);
    activeBrushId = input<number>(0);

    setTexture = output<{polyIndex: number, texId: number}>();
    
    editorService = inject(EditorService);

    goToTexture(id: number) {
        this.editorService.selectTexture(id);
    }

    hasWallTextureFlag(flags: number): boolean {
        return (flags & 32) !== 0;
    }
}
