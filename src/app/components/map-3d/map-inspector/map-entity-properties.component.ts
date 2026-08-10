import { Component, input, output, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { EntityDetails } from './map-inspector.component';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { EditorService } from '../../../services/editor.service';
import { MAX_SAFE_ENTITY_ID } from '../../../core/constants/entity-types';
import { EntityPickerComponent, EntityTemplate } from '../entity-picker/entity-picker.component';
import { SpriteFlag } from '../../../core/constants/map-flags';

@Component({
  selector: 'app-map-entity-properties',
  standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent, EntityPickerComponent],
  template: `
    @if (data(); as info) {
        <!-- ENTITY INFO HEADER -->
        <div class="mb-4 bg-neutral-950 border border-neutral-800 rounded p-2">
            <div class="flex items-center gap-3">
                <div class="w-16 h-16 bg-black border border-neutral-800 shrink-0 cursor-pointer hover:border-white transition-colors"
                     (click)="goToTexture(info.texture?.id)">
                    @if (info.texture) {
                        <app-texture-thumbnail [id]="info.texture.id" />
                    }
                </div>
                <div>
                    <div class="text-white font-bold text-sm">Entity #{{ info.spriteIndex }}</div>
                    @if (info.entityDef) {
                        <div class="text-amber-500 font-bold">Def: Type {{ info.entityDef.eType }}, Sub {{ info.entityDef.eSubType }}</div>
                    } @else {
                        <div class="text-neutral-500 italic">Decor / No Def</div>
                    }
                    
                    @if (info.spriteIndex > MAX_SAFE_ENTITY_ID) {
                        <div class="text-red-400 text-[10px] mt-1 border border-red-900 bg-red-900/10 px-1 rounded">
                            ⚠ ID > {{MAX_SAFE_ENTITY_ID}}. Be careful in scripts.
                            <button (click)="swapEntityId.emit()" class="ml-2 underline text-amber-400 hover:text-amber-300">
                                Try to swap with unused ID < 255
                            </button>
                        </div>
                    }
                </div>
            </div>
        </div>

        <!-- PROPERTIES VIEWER (EDITABLE) -->
        <div class="mb-4 space-y-3 bg-neutral-800/20 p-2 rounded border border-neutral-800">
             <div class="text-[10px] font-bold text-neutral-500 uppercase flex justify-between">
                <span>Properties</span>
                <span class="text-xs text-green-500">✏️ Editable</span>
             </div>
             
             <button type="button" (click)="pickerOpen = !pickerOpen" class="w-full bg-blue-900/40 border border-blue-800 text-blue-200 py-1 rounded">Choose entity type…</button>
             @if (pickerOpen) { <app-entity-picker actionLabel="Change type" (picked)="changeTemplate($event)" /> }

             <label class="flex gap-2 items-center text-[10px] text-neutral-400"><input type="checkbox" [(ngModel)]="advanced" /> Advanced values</label>
             @if (advanced) {
               <div class="grid grid-cols-2 gap-2">
                 <div><label class="block text-[10px] text-neutral-400 mb-1">Numeric Group ID</label>
                     <input 
                        type="number" 
                        [ngModel]="info.raw.textureId" 
                        (ngModelChange)="updateProperty('textureId', $event)"
                        class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none" 
                     />
                 </div>
                 <div>
                     <label class="block text-[10px] text-neutral-400 mb-1">Flags</label>
                     <input 
                        type="number" 
                        [ngModel]="info.raw.flags" 
                        (ngModelChange)="updateProperty('flags', $event)"
                        class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none" 
                     />
                 </div>
               </div>
             }

             <div>
                 <label class="block text-[10px] text-neutral-400 mb-1">Type</label>
                 <select 
                      [ngModel]="info.raw.type"
                      (ngModelChange)="updateProperty('type', $event)"
                      class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none"
                 >
                     <option value="normal">Normal</option>
                     <option value="z">Z (Fixed Height)</option>
                 </select>
             </div>

             <div class="grid grid-cols-3 gap-2">
                 <div>
                     <label class="block text-[10px] text-neutral-400 mb-1">X</label>
                     <input 
                        type="number" 
                        [ngModel]="info.raw.x" 
                        (ngModelChange)="updateProperty('x', $event)"
                        class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none" 
                     />
                 </div>
                 <div>
                     <label class="block text-[10px] text-neutral-400 mb-1">Y (Height)</label>
                     <input 
                        type="number" 
                        [ngModel]="info.raw.z" 
                        (ngModelChange)="updateProperty('z', $event)"
                        class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none" 
                     />
                 </div>
                 <div>
                     <label class="block text-[10px] text-neutral-400 mb-1">Z (Depth)</label>
                     <input 
                        type="number" 
                        [ngModel]="info.raw.y" 
                        (ngModelChange)="updateProperty('y', $event)"
                        class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none" 
                     />
                 </div>
             </div>
             
             @if (info.raw.type === 'z') {
                 <div>
                     <label class="block text-[10px] text-neutral-400 mb-1">Extra Info (Z-Sprite)</label>
                     <input 
                        type="number" 
                        [ngModel]="info.raw.extraInfo" 
                        (ngModelChange)="updateProperty('extraInfo', $event)"
                        class="w-full bg-black border border-neutral-700 text-white px-1 text-xs h-6 focus:border-red-600 outline-none" 
                     />
                 </div>
             }
             
             <div class="pt-2 mt-2 border-t border-neutral-800">
                 <button (click)="deleteEntity.emit()" class="w-full py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 border border-red-900/50 rounded transition-colors text-xs font-bold">
                     🗑️ Delete Entity
                 </button>
             </div>
             
             <!-- Decoded Flags -->
             <div class="mt-2 pt-2 border-t border-neutral-800">
                <div class="text-[9px] text-neutral-500 uppercase mb-1">Active Flags</div>
                <div class="flex flex-wrap gap-1">
                    @for (flag of info.flagsDecoded; track $index) {
                        <span class="px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded text-[10px]">{{ flag }}</span>
                    } @empty {
                        <span class="text-neutral-600 italic text-[10px]">None</span>
                    }
                </div>
            </div>
        </div>
    }
  `
})
export class MapEntityPropertiesComponent implements OnDestroy {
    data = input<EntityDetails | null>(null);
    entityUpdated = output<void>();
    deleteEntity = output<void>();
    swapEntityId = output<void>();
    
    editorService = inject(EditorService);
    MAX_SAFE_ENTITY_ID = MAX_SAFE_ENTITY_ID;
    pickerOpen = false;
    advanced = false;
    
    private snapSubject = new Subject<{prop: string, value: number, info: EntityDetails}>();
    private snapSub: Subscription;

    constructor() {
        this.snapSub = this.snapSubject.pipe(
            debounceTime(1000)
        ).subscribe(({prop, value, info}) => {
            const snapped = Math.round(value / 8) * 8;
            if ((info.raw as any)[prop] !== snapped) {
                (info.raw as any)[prop] = snapped;
                this.entityUpdated.emit();
            }
        });
    }

    ngOnDestroy() {
        this.snapSub.unsubscribe();
    }

    goToTexture(id: number | undefined) {
        if (id !== undefined) this.editorService.selectTexture(id);
    }

    changeTemplate(template: EntityTemplate) {
        const info = this.data();
        if (!info) return;
        let resetFlags = info.raw.flags & ~template.flags;
        if (template.textureId >= 18 && template.textureId <= 80) resetFlags |= info.raw.flags & (SpriteFlag.Wall | SpriteFlag.Flat);
        const resetsExtra = info.raw.extraInfo !== 0 && template.type !== 'z';
        const details = [resetFlags ? `flags 0x${resetFlags.toString(16)}` : '', resetsExtra ? `extra data ${info.raw.extraInfo}` : ''].filter(Boolean);
        if (details.length && !confirm(`This entity type is incompatible with ${details.join(' and ')}. These values will be reset. Continue?`)) return;
        info.raw.textureId = template.textureId;
        info.raw.type = template.type;
        info.raw.flags = template.flags & 0xffff;
        info.raw.extraInfo = template.type === 'z' ? Math.max(0, Math.min(255, template.extraInfo)) : 0;
        this.pickerOpen = false;
        this.entityUpdated.emit();
    }
    
    updateProperty(prop: string, value: any) {
        const info = this.data();
        if (!info) return;
        if (prop === 'type' && value === 'normal' && info.raw.extraInfo !== 0) {
            if (!confirm(`Changing to a normal sprite will reset extra data ${info.raw.extraInfo}. Continue?`)) return;
            info.raw.extraInfo = 0;
        }
        
        // Convert to number where appropriate
        if (['textureId', 'flags', 'x', 'y', 'z', 'extraInfo'].includes(prop)) {
            value = Number(value) || 0;
            if (prop === 'x' || prop === 'z') {
                this.snapSubject.next({prop, value, info});
            }
        }
        
        (info.raw as any)[prop] = value;
        this.entityUpdated.emit();
    }
}
