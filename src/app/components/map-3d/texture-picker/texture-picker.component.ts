import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomTextureService, TextureInfo } from '../../../services/doom-texture.service';
import { SpecialTextureIds } from '../../../core/constants/texture-groups';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';

@Component({ selector: 'app-map-texture-picker', standalone: true, imports: [FormsModule, TextureThumbnailComponent], template: `
  <div class="bg-neutral-950 border border-neutral-800 rounded p-2">
    <input placeholder="Search texture or group" [ngModel]="query()" (ngModelChange)="query.set($event)" class="w-full bg-black border border-neutral-700 px-2 py-1 mb-2" />
    <div class="grid grid-cols-4 gap-1 max-h-44 overflow-y-auto">
      @for (tex of choices(); track tex.id) { <button type="button" (click)="selected.emit(tex)" class="border border-neutral-800 hover:border-amber-500 p-1" [title]="mode() + ' group ' + tex.groupId">
        <span class="block h-10 bg-black"><app-texture-thumbnail [id]="tex.id" /></span><span class="text-[9px]">{{tex.groupId}}</span>
      </button> }
    </div>
  </div>` })
export class MapTexturePickerComponent {
  mode = input.required<'wall' | 'flat'>(); selected = output<TextureInfo>(); query = signal(''); textures = inject(DoomTextureService);
  choices = computed(() => { const wall = this.mode() === 'wall'; const q = this.query().trim(); const seen = new Set<number>(); return this.textures.textureList().filter(t => t.valid && (wall ? t.groupId >= SpecialTextureIds.WALL_OFFSET : t.category === 'Flats' && t.groupId < SpecialTextureIds.WALL_OFFSET) && (!q || `${t.id} ${t.groupId}`.includes(q)) && !seen.has(t.groupId) && !!seen.add(t.groupId)); });
}
