import { CommonModule } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomScriptService, ScriptData, TileEventRef } from '../../../services/doom-script.service';
import { EntityDetails } from './map-inspector.component';
import { ScriptEntryNameService } from '../../../services/scripts/script-entry-name.service';

@Component({
  selector: 'app-map-script-linker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (data(); as info) {
      <div class="mb-4 bg-blue-900/20 border border-blue-900/50 rounded p-2">
        <div class="flex justify-between items-center mb-2">
          <span class="text-[10px] font-bold text-blue-300 uppercase">Tile events</span>
          <span class="text-[10px] font-mono text-white">#{{ getTileIndex(info) }}</span>
        </div>

        @for (ref of getAttachedScripts(info); track ref.uid) {
          <div class="mb-2 rounded border border-neutral-700 bg-neutral-900/70 p-2">
            <div class="flex items-center justify-between text-[10px] mb-2">
              <button class="text-blue-300 hover:underline" (click)="jumpToScript.emit(ref.targetUid)">
                0x{{ getScriptOffsetHex(ref) }} · {{ getFlagName(ref.flags) }}
              </button>
              <div class="flex gap-2">
                <button class="text-neutral-300 hover:text-white" title="Duplicate" (click)="duplicate(ref)">⧉</button>
                <button class="text-red-400 hover:text-red-300" title="Delete" (click)="remove(ref)">✕</button>
              </div>
            </div>

            <label class="block text-[9px] text-neutral-500 mb-1">Event type / flags</label>
            <select class="w-full bg-neutral-950 border border-neutral-700 rounded px-1 py-1 text-[10px] mb-1"
                    [ngModel]="ref.flags" (ngModelChange)="updateFlags(ref, $event)">
              @for (flag of flagOptions; track flag.value) {
                <option [ngValue]="flag.value">{{ flag.label }} (0x{{ flag.value.toString(16).toUpperCase() }})</option>
              }
              @if (!isPresetFlag(ref.flags)) { <option [ngValue]="ref.flags">Custom (0x{{ ref.flags.toString(16).toUpperCase() }})</option> }
            </select>

            <label class="block text-[9px] text-neutral-500 mb-1">Handler target</label>
            <select class="w-full bg-neutral-950 border border-neutral-700 rounded px-1 py-1 text-[10px]"
                    [ngModel]="ref.targetUid" (ngModelChange)="updateTarget(ref, $event)">
              <optgroup label="Static functions">
                @for (entry of staticTargets(); track entry.index) {
                  <option [ngValue]="entry.uid">{{ entry.label }}</option>
                }
              </optgroup>
              <optgroup label="Instructions">
                @for (inst of scriptData()?.instructions ?? []; track inst.uid) {
                  <option [ngValue]="inst.uid">{{ targetLabel(inst.uid) }}</option>
                }
              </optgroup>
            </select>
          </div>
        } @empty {
          <div class="text-[10px] text-neutral-500 mb-2 italic">No event attached to this tile.</div>
        }

        <div class="grid grid-cols-2 gap-2 mt-2">
          <button (click)="addExisting(info)" [disabled]="!scriptData()?.instructions?.length"
                  class="bg-blue-800 hover:bg-blue-700 disabled:opacity-40 text-white text-[10px] py-1 rounded">
            + Link existing
          </button>
          <button (click)="createHandler(info)"
                  class="bg-emerald-800 hover:bg-emerald-700 text-white text-[10px] py-1 rounded">
            + New handler
          </button>
        </div>
      </div>
    }
  `
})
export class MapScriptLinkerComponent {
  private scriptService = inject(DoomScriptService);
  private entryNames = inject(ScriptEntryNameService);

  data = input<EntityDetails | null>(null);
  scriptData = input<ScriptData | null>(null);
  jumpToScript = output<string>();
  eventsChanged = output<number>();

  readonly flagOptions = [
    { value: 0xff1, label: 'Enter' },
    { value: 0xff2, label: 'Leave' },
    { value: 0xff4, label: 'Use / trigger' },
    { value: 0xff8, label: 'Attack' }
  ];

  getTileIndex(info: EntityDetails): number {
    const gridX = Math.round(info.raw.x) >> 6;
    const gridY = Math.round(info.raw.z) >> 6;
    return gridY * 32 + gridX;
  }

  getAttachedScripts(info: EntityDetails): TileEventRef[] {
    const tileIndex = this.getTileIndex(info);
    return this.scriptData()?.tileEventRefs.filter(ref => ref.tileIndex === tileIndex) ?? [];
  }

  staticTargets(): Array<{ index: number; uid: string; offset: string; label: string }> {
    const data = this.scriptData();
    if (!data) return [];
    return Object.entries(data.staticFuncs).flatMap(([index, uid]) => {
      const inst = data.instructions.find(candidate => candidate.uid === uid);
      return inst ? [{ index: Number(index), uid, offset: this.hex(inst.offset), label: this.entryNames.display(data, inst) }] : [];
    });
  }

  async addExisting(info: EntityDetails): Promise<void> {
    const data = this.scriptData();
    const target = data?.instructions[0];
    if (data && target && await this.scriptService.addTileEvent(data.mapId, this.getTileIndex(info), target.uid, 0xff4)) this.changed(info);
  }

  async createHandler(info: EntityDetails): Promise<void> {
    const data = this.scriptData();
    if (data && await this.scriptService.createTileEventHandler(data.mapId, this.getTileIndex(info), 0xff4)) this.changed(info);
  }

  async duplicate(ref: TileEventRef): Promise<void> {
    const data = this.scriptData();
    if (data && await this.scriptService.duplicateTileEvent(data.mapId, ref.uid)) this.eventsChanged.emit(ref.tileIndex);
  }

  async remove(ref: TileEventRef): Promise<void> {
    const data = this.scriptData();
    if (data && await this.scriptService.deleteTileEvent(data.mapId, ref.uid)) this.eventsChanged.emit(ref.tileIndex);
  }

  async updateFlags(ref: TileEventRef, flags: number): Promise<void> {
    await this.update(ref, ref.targetUid, Number(flags));
  }

  async updateTarget(ref: TileEventRef, targetUid: string): Promise<void> {
    await this.update(ref, targetUid, ref.flags);
  }

  private async update(ref: TileEventRef, targetUid: string, flags: number): Promise<void> {
    const data = this.scriptData();
    if (data && await this.scriptService.updateTileEvent(data.mapId, ref.uid, { targetUid, flags })) this.eventsChanged.emit(ref.tileIndex);
  }

  private changed(info: EntityDetails): void {
    this.eventsChanged.emit(this.getTileIndex(info));
  }

  getScriptOffsetHex(ref: TileEventRef): string {
    const inst = this.scriptData()?.instructions.find(candidate => candidate.uid === ref.targetUid);
    return inst ? this.hex(inst.offset) : '????';
  }

  targetLabel(uid: string): string {
    const data = this.scriptData();
    const instruction = data?.instructions.find(item => item.uid === uid);
    return data && instruction ? this.entryNames.display(data, instruction) : 'Missing target';
  }

  hex(value: number): string { return value.toString(16).toUpperCase().padStart(4, '0'); }
  isPresetFlag(flags: number): boolean { return this.flagOptions.some(option => option.value === flags); }
  getFlagName(flags: number): string { return this.flagOptions.find(option => option.value === flags)?.label ?? 'Custom'; }
}
