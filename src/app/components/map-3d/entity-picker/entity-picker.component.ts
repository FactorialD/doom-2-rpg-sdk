import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomEntitiesService, EntityDef } from '../../../services/doom-entities.service';
import { DoomTextureService } from '../../../services/doom-texture.service';
import { SpriteCompositorService } from '../../../services/textures/sprite-compositor.service';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { TextureCompositeComponent } from '../../texture-viewer/texture-composite/texture-composite.component';

export interface EntityTemplate {
  textureId: number;
  flags: number;
  extraInfo: number;
  type: 'normal' | 'z';
  definition?: EntityDef;
}

const TYPE_NAMES: Record<number, string> = {
  2: 'Monsters', 3: 'NPCs', 5: 'Doors', 6: 'Items', 7: 'Decor', 8: 'Hazards',
  9: 'Corpses', 10: 'Destroyables', 12: 'Sprite walls', 13: 'Sprite walls', 14: 'Decor'
};

@Component({
  selector: 'app-entity-picker', standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent, TextureCompositeComponent],
  template: `
    <div class="bg-neutral-950 border border-neutral-700 rounded p-2 space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <input aria-label="Search entities" placeholder="Search type, subtype, group…" [ngModel]="query()" (ngModelChange)="query.set($event)"
          class="bg-black border border-neutral-700 px-2 py-1 text-xs text-white" />
        <select aria-label="Entity category" [ngModel]="category()" (ngModelChange)="category.set($event)" class="bg-black border border-neutral-700 text-xs text-white">
          <option value="all">All categories</option>
          @for (cat of categories(); track cat) { <option [value]="cat">{{ cat }}</option> }
        </select>
      </div>
      <div class="max-h-48 overflow-y-auto grid grid-cols-2 gap-1">
        @for (def of filtered(); track def.tileIndex + ':' + def.eType + ':' + def.eSubType) {
          <button type="button" (click)="choose(def)" class="text-left flex gap-2 p-1 border rounded hover:border-amber-500"
            [class.border-amber-500]="selected()?.tileIndex === def.tileIndex" [class.border-neutral-800]="selected()?.tileIndex !== def.tileIndex">
            <span class="w-10 h-10 bg-black shrink-0"><app-texture-thumbnail [id]="previewId(def.tileIndex)" /></span>
            <span class="min-w-0"><b class="block text-white">Group {{ def.tileIndex }}</b><span class="text-[9px] text-neutral-400">{{ typeName(def) }} · Def {{def.eType}}/{{def.eSubType}} · parm {{def.parm}}</span></span>
          </button>
        } @empty { <div class="col-span-2 text-neutral-500 p-2">No matching entity definitions.</div> }
      </div>
      @if (selected(); as def) {
        <div class="grid grid-cols-2 gap-2 border-t border-neutral-800 pt-2">
          <div>
            @if (compositor.isComposite(def.tileIndex)) {
              <app-texture-composite [textures]="textures.getGroupTextures(def.tileIndex)" />
            } @else { <div class="h-20 bg-black"><app-texture-thumbnail [id]="previewId(def.tileIndex)" /></div> }
          </div>
          <div class="text-[10px] text-neutral-300 space-y-1">
            <div>Entity definition: {{def.eType}} / {{def.eSubType}}</div><div>Group ID: {{def.tileIndex}}</div><div>Name ID: {{def.nameId}}</div>
            <label class="block">Placement <select [(ngModel)]="placementType" class="ml-1 bg-black border border-neutral-700"><option value="normal">Normal</option><option value="z">Fixed height</option></select></label>
            <label class="block">Flags <input type="number" [(ngModel)]="flags" min="0" max="65535" class="w-20 bg-black border border-neutral-700" /></label>
            <label class="block">Extra <input type="number" [(ngModel)]="extraInfo" min="0" max="255" class="w-20 bg-black border border-neutral-700" /></label>
            <button type="button" (click)="apply(def)" class="block w-full bg-blue-700 hover:bg-blue-600 text-white rounded py-1">{{ actionLabel() }}</button>
          </div>
        </div>
      }
    </div>`,
})
export class EntityPickerComponent {
  actionLabel = input('Use entity');
  picked = output<EntityTemplate>();
  entities = inject(DoomEntitiesService);
  textures = inject(DoomTextureService);
  compositor = inject(SpriteCompositorService);
  query = signal(''); category = signal('all'); selected = signal<EntityDef | null>(null);
  flags = 0; extraInfo = 0; placementType: 'normal' | 'z' = 'normal';
  categories = computed(() => [...new Set(this.entities.getAllDefs().map(d => this.typeName(d)))].sort());
  filtered = computed(() => { const q = this.query().trim().toLowerCase(); const cat = this.category(); return this.entities.getAllDefs().filter(d => (cat === 'all' || this.typeName(d) === cat) && (!q || `${this.typeName(d)} ${d.tileIndex} ${d.eType} ${d.eSubType} ${d.parm}`.toLowerCase().includes(q))); });
  typeName(d: EntityDef) { return TYPE_NAMES[d.eType] ?? `Type ${d.eType}`; }
  previewId(groupId: number) { return this.textures.getTextureByGroup(groupId)?.id ?? -1; }
  choose(def: EntityDef) { this.selected.set(def); this.flags = 0; this.extraInfo = 0; this.placementType = 'normal'; }
  apply(def: EntityDef) { this.picked.emit({ textureId: def.tileIndex, flags: Number(this.flags), extraInfo: Number(this.extraInfo), type: this.placementType, definition: def }); }
}
