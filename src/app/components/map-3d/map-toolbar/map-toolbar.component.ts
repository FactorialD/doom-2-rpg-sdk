
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapRendererService } from '../../../services/map-renderer.service';

export type EditMode = 'select' | 'paint' | 'wall' | 'polygon';

@Component({
  selector: 'app-map-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="h-12 bg-neutral-900 border-b border-neutral-800 flex items-center px-4 justify-between shrink-0 z-10 select-none">
      <div class="flex items-center gap-4">
           <!-- Map Selection -->
           <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-neutral-500 uppercase">Map</span>
              <select [ngModel]="selectedMapId()" (ngModelChange)="loadMap.emit(+$event)" class="bg-neutral-800 border border-neutral-700 text-xs text-white rounded px-2 py-1 outline-none focus:border-red-600">
                  <option [value]="1">Map 01</option>
                  <option [value]="2">Map 02</option>
                  <option [value]="3">Map 03</option>
                  <option [value]="4">Map 04</option>
                  <option [value]="5">Map 05</option>
                  <option [value]="6">Map 06</option>
                  <option [value]="7">Map 07</option>
                  <option [value]="8">Map 08</option>
                  <option [value]="9">Map 09</option>
              </select>
           </div>
           
           <div class="h-6 w-px bg-neutral-700"></div>

           <!-- Edit Modes -->
           <div class="flex bg-neutral-950 rounded border border-neutral-700 p-0.5">
              <button 
                  (click)="editModeChange.emit('select')" 
                  [class.bg-neutral-700]="editMode() === 'select'"
                  class="px-3 py-1 text-xs text-white rounded transition-colors" title="Select & Inspect">
                  👆 Select
              </button>
              <button 
                  (click)="editModeChange.emit('paint')" 
                  [class.bg-neutral-700]="editMode() === 'paint'"
                  class="px-3 py-1 text-xs text-white rounded transition-colors" title="Paint Textures">
                  🎨 Paint
              </button>
              <button (click)="editModeChange.emit('wall')" [class.bg-red-800]="editMode() === 'wall'"
                  class="px-3 py-1 text-xs text-white rounded" title="Draw a BSP-safe wall">🧱 Wall</button>
              <button (click)="editModeChange.emit('polygon')" [class.bg-red-800]="editMode() === 'polygon'"
                  class="px-3 py-1 text-xs text-white rounded" title="Draw a BSP-safe flat polygon">⬡ Polygon</button>
           </div>
           
           <div class="h-6 w-px bg-neutral-700"></div>
           
           <!-- Toggles -->
           <div class="flex items-center gap-3 text-xs text-neutral-300">
               <label class="flex items-center gap-1 cursor-pointer hover:text-white">
                  <input type="checkbox" [ngModel]="renderer.geometry.showWalls()" (ngModelChange)="renderer.geometry.showWalls.set($event)" class="accent-red-600"> Walls
               </label>
               <label class="flex items-center gap-1 cursor-pointer hover:text-white">
                  <input type="checkbox" [ngModel]="renderer.geometry.showFlats()" (ngModelChange)="renderer.geometry.showFlats.set($event)" class="accent-red-600"> Flats
               </label>
               <label class="flex items-center gap-1 cursor-pointer hover:text-white">
                  <input type="checkbox" [ngModel]="renderer.entities.showSprites()" (ngModelChange)="renderer.entities.showSprites.set($event)" class="accent-red-600"> Sprites
               </label>
           </div>
      </div>
      
      <div class="flex items-center gap-2">
          <button (click)="undo.emit()" [disabled]="!canUndo()" class="px-2 py-1 text-xs rounded bg-neutral-800 disabled:opacity-30" title="Undo">↶</button>
          <button (click)="redo.emit()" [disabled]="!canRedo()" class="px-2 py-1 text-xs rounded bg-neutral-800 disabled:opacity-30" title="Redo">↷</button>
          @if (operationActive()) {
            <button (click)="confirmOperation.emit()" class="px-2 py-1 text-xs font-bold rounded bg-green-700">✓ Confirm</button>
            <button (click)="cancelOperation.emit()" class="px-2 py-1 text-xs rounded bg-neutral-700">✕ Cancel</button>
          }
          <button 
              (click)="addEntity.emit()"
              class="flex items-center gap-2 px-3 py-1 text-xs font-bold text-white bg-blue-700 hover:bg-blue-600 rounded transition-colors"
          >
              <span>➕</span> Add Entity
          </button>
          
          <button 
              (click)="saveMap.emit()"
              class="flex items-center gap-2 px-3 py-1 text-xs font-bold text-white bg-green-700 hover:bg-green-600 rounded transition-colors"
          >
              <span>💾</span> Save Map
          </button>
          
          <button 
              (click)="renderer.controls.toggleFlyMode()"
              class="flex items-center gap-2 px-3 py-1 text-xs rounded transition-colors border"
              [class.bg-red-900_20]="renderer.controls.flyMode()"
              [class.border-red-600]="renderer.controls.flyMode()"
              [class.text-red-400]="renderer.controls.flyMode()"
              [class.border-neutral-700]="!renderer.controls.flyMode()"
              [class.bg-neutral-800]="!renderer.controls.flyMode()"
              [class.text-neutral-300]="!renderer.controls.flyMode()"
          >
              <span>✈️</span>
              <span class="font-bold">Fly</span>
          </button>
      </div>
    </div>
  `
})
export class MapToolbarComponent {
    selectedMapId = input<number>(1);
    editMode = input<EditMode>('select');
    canUndo = input(false);
    canRedo = input(false);
    operationActive = input(false);
    
    loadMap = output<number>();
    editModeChange = output<EditMode>();
    saveMap = output<void>();
    addEntity = output<void>();
    undo = output<void>();
    redo = output<void>();
    confirmOperation = output<void>();
    cancelOperation = output<void>();

    constructor(public renderer: MapRendererService) {}
}
