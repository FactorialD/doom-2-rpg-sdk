import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ENTITY_SUBTYPE_NAMES, ENTITY_TYPE_NAMES, EntityType } from '../../../core/constants/entity-types';
import { EDITABLE_SPRITE_FLAGS } from '../../../core/constants/map-flags';
import { DIALOG_STYLE_OPTIONS, DialogStyle, TILE_EVENT_FLAG_OPTIONS } from '../../../core/constants/scripting';
import { DoomEntitiesService, EntityDef } from '../../../services/doom-entities.service';
import { DoomScriptService } from '../../../services/doom-script.service';
import { DoomTextService, TextEntry } from '../../../services/doom-text.service';
import { DoomTextureService } from '../../../services/doom-texture.service';
import { SpriteCompositorService } from '../../../services/textures/sprite-compositor.service';
import { TextureCompositeComponent } from '../../texture-viewer/texture-composite/texture-composite.component';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';

export type EntityCreationAction =
  | { kind: 'none' }
  | { kind: 'dialog'; stringId: number; style: DialogStyle }
  | { kind: 'existing'; targetUid: string; flags: number }
  | { kind: 'new-handler'; flags: number };

export interface EntityTemplate {
  textureId: number; flags: number; extraInfo: number; type: 'normal' | 'z';
  definition: EntityDef; action: EntityCreationAction;
}

@Component({
  selector: 'app-entity-picker', standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent, TextureCompositeComponent],
  template: `
    <div class="bg-neutral-950 border border-neutral-700 rounded p-3 space-y-3 text-xs">
      @if (!entities.isLoaded()) { <p class="text-amber-400">Load a JAR with entities.bin before placing entities.</p> }
      <div class="grid grid-cols-2 gap-2">
        <label>Category<select aria-label="Entity category" [ngModel]="category()" (ngModelChange)="selectCategory(+$event)" class="block w-full bg-black border border-neutral-700 p-1">
          @for (cat of categories(); track cat.type) { <option [ngValue]="cat.type">{{cat.label}}</option> }
        </select></label>
        <label>Entity<select aria-label="Entity definition" [ngModel]="selected()?.index" (ngModelChange)="selectDefinition(+$event)" class="block w-full bg-black border border-neutral-700 p-1">
          @for (def of categoryDefs(); track def.index) { <option [ngValue]="def.index">{{entityName(def)}}</option> }
        </select></label>
      </div>
      @if (selected(); as def) {
        <div class="grid grid-cols-[6rem_1fr] gap-3 border-t border-neutral-800 pt-2">
          @if (compositor.isComposite(def.tileIndex)) { <app-texture-composite [textures]="textures.getGroupTextures(def.tileIndex)" /> }
          @else { <div class="h-24 bg-black"><app-texture-thumbnail [id]="previewId(def.tileIndex)" /></div> }
          <div class="space-y-2">
            <b class="text-white">{{entityName(def)}}</b>
            <p class="text-neutral-400">{{typeName(def)}} · {{subtypeName(def)}} · parameter {{def.parm}} · texture group {{def.tileIndex}}</p>
            <label class="block">Placement <select [(ngModel)]="placementType" class="bg-black border border-neutral-700"><option value="normal">On floor</option><option value="z">Fixed height</option></select></label>
            <fieldset><legend class="text-neutral-400">Sprite flags</legend>
              <div class="grid grid-cols-2">@for (flag of spriteFlags; track flag.value) { <label><input type="checkbox" [checked]="hasFlag(flag.value)" (change)="toggleFlag(flag.value)"> {{flag.label}}</label> }</div>
            </fieldset>
            @if (placementType === 'z') { <label class="block">Z-sprite extra/animation byte (0–255) <input type="number" [(ngModel)]="extraInfo" min="0" max="255" class="w-20 bg-black border border-neutral-700"></label> }
            <label class="block">After placement <select [(ngModel)]="actionKind" (ngModelChange)="loadActionData()" class="bg-black border border-neutral-700">
              <option value="none">No action</option><option value="dialog">Dialog on Use</option><option value="existing">Link existing handler</option><option value="new-handler">New empty handler</option>
            </select></label>
            @if (actionKind === 'dialog') {
              <label class="block">Dialog text <select [(ngModel)]="dialogStringId" class="w-full bg-black border border-neutral-700">@for (s of strings(); track s.id) { <option [ngValue]="s.id">#{{s.id}} · {{excerpt(s.raw)}}</option> }</select></label>
              <label>Dialog style <select [(ngModel)]="dialogStyle" class="bg-black border border-neutral-700">@for (s of dialogStyles; track s[0]) { <option [ngValue]="s[0]">{{s[1]}}</option> }</select></label>
            }
            @if (actionKind === 'existing') { <label class="block">Handler <select [(ngModel)]="targetUid" class="w-full bg-black border border-neutral-700">@for (i of instructions(); track i.uid) { <option [ngValue]="i.uid">0x{{i.offset.toString(16)}} · {{i.readableName}}</option> }</select></label> }
            @if (actionKind === 'existing' || actionKind === 'new-handler') { <label>Event <select [(ngModel)]="eventFlags" class="bg-black border border-neutral-700">@for (f of eventFlagOptions; track f.value) { <option [ngValue]="f.value">{{f.label}}</option> }</select></label> }
            <details><summary>Advanced raw values</summary><label class="block">Raw flags <input aria-label="Raw sprite flags" type="number" [(ngModel)]="flags" min="0" max="65535" class="w-24 bg-black border border-neutral-700"></label></details>
            <button type="button" [disabled]="!canApply()" (click)="apply(def)" class="w-full bg-blue-700 disabled:opacity-40 text-white rounded py-1">{{actionLabel()}}</button>
          </div>
        </div>
      }
    </div>`
})
export class EntityPickerComponent {
  actionLabel = input('Use entity'); mapId = input(1); picked = output<EntityTemplate>();
  entities = inject(DoomEntitiesService); textures = inject(DoomTextureService); compositor = inject(SpriteCompositorService);
  private text = inject(DoomTextService); private scripts = inject(DoomScriptService);
  category = signal<number>(EntityType.Npc); selected = signal<EntityDef | null>(null); strings = signal<TextEntry[]>([]); instructions = signal<any[]>([]);
  flags = 0; extraInfo = 0; placementType: 'normal' | 'z' = 'normal'; actionKind: EntityCreationAction['kind'] = 'none';
  dialogStringId = -1; dialogStyle = DialogStyle.NPC; targetUid = ''; eventFlags = 0xff4;
  readonly spriteFlags = EDITABLE_SPRITE_FLAGS; readonly dialogStyles = DIALOG_STYLE_OPTIONS; readonly eventFlagOptions = TILE_EVENT_FLAG_OPTIONS;
  categories = computed(() => [...new Set(this.entities.getAllDefs().map(d => d.eType))].map(type => ({ type, label: ENTITY_TYPE_NAMES[type] ?? `Other type ${type}` })).sort((a, b) => a.label.localeCompare(b.label)));
  categoryDefs = computed(() => this.entities.getAllDefs().filter(d => d.eType === this.category()));
  constructor() { queueMicrotask(() => { const first = this.categoryDefs()[0] ?? this.entities.getAllDefs()[0]; if (first) { this.category.set(first.eType); this.choose(first); } }); }
  selectCategory(type: number) { this.category.set(type); const first = this.categoryDefs()[0] ?? null; this.selected.set(first); if (first) this.choose(first); }
  selectDefinition(index: number) { const def = this.entities.getDef(index); if (def && def.eType === this.category()) this.choose(def); }
  choose(def: EntityDef) { this.selected.set(def); this.flags = 0; this.extraInfo = 0; this.placementType = 'normal'; }
  typeName(d: EntityDef) { return ENTITY_TYPE_NAMES[d.eType] ?? `Other type ${d.eType}`; }
  subtypeName(d: EntityDef) { return ENTITY_SUBTYPE_NAMES[d.eType as EntityType]?.[d.eSubType] ?? `Subtype ${d.eSubType}`; }
  entityName(d: EntityDef) { const value = this.text.getStringValue(1, d.nameId); return value.startsWith('STR_') ? `${this.subtypeName(d)} ${d.parm}` : value; }
  previewId(id: number) { return this.textures.getTextureByGroup(id)?.id ?? -1; }
  hasFlag(bit: number) { return (this.flags & bit) !== 0; } toggleFlag(bit: number) { this.flags ^= bit; }
  excerpt(value: string) { return value.replace(/\s+/g, ' ').slice(0, 64); }
  async loadActionData() { if (this.actionKind === 'dialog') { this.strings.set(this.text.getMapStrings(this.mapId())); this.dialogStringId = this.strings()[0]?.id ?? -1; } const data = await this.scripts.ensureScriptLoaded(this.mapId()); this.instructions.set(data?.instructions ?? []); this.targetUid ||= this.instructions()[0]?.uid ?? ''; }
  canApply() { return !!this.selected() && (this.actionKind !== 'dialog' || this.dialogStringId >= 0) && (this.actionKind !== 'existing' || !!this.targetUid); }
  apply(def: EntityDef) { if (!this.entities.getAllDefs().includes(def) || !this.canApply()) return; const action: EntityCreationAction = this.actionKind === 'dialog' ? { kind: 'dialog', stringId: this.dialogStringId, style: this.dialogStyle } : this.actionKind === 'existing' ? { kind: 'existing', targetUid: this.targetUid, flags: this.eventFlags } : this.actionKind === 'new-handler' ? { kind: 'new-handler', flags: this.eventFlags } : { kind: 'none' }; this.picked.emit({ textureId: def.tileIndex, flags: Number(this.flags), extraInfo: this.placementType === 'z' ? Number(this.extraInfo) : 0, type: this.placementType, definition: def, action }); }
}
