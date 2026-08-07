
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapRendererService } from '../../../services/map-renderer.service';

export type EditMode = 'select' | 'paint';

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
          @if (renderer.controls.flyMode()) {
              <label class="flex items-center gap-1 text-[10px] text-neutral-400" title="Base flight speed; use the mouse wheel over the viewport for a temporary adjustment">
                  Speed
                  <input type="range" min="250" max="12000" step="250"
                      [ngModel]="renderer.controls.flySpeed()"
                      (ngModelChange)="renderer.controls.setFlySpeed(+$event)"
                      class="w-20 accent-red-600">
                  <span class="w-10 text-right">{{ renderer.controls.flySpeed() }}</span>
              </label>
          }
          <button (click)="focusSelected.emit()" [disabled]="!hasSelection()"
              class="px-2 py-1 text-xs rounded border border-neutral-700 bg-neutral-800 text-neutral-300 disabled:opacity-40"
              title="Focus the camera on the selected object">🎯 Focus</button>
          <button (click)="renderer.controls.resetView()"
              class="px-2 py-1 text-xs rounded border border-neutral-700 bg-neutral-800 text-neutral-300"
              title="Reset camera position">↺ Reset</button>
          <details class="relative">
              <summary class="list-none cursor-pointer px-2 py-1 text-xs rounded border border-neutral-700 bg-neutral-800 text-neutral-300" title="Camera controls">? Help</summary>
              <div class="absolute right-0 top-8 z-30 w-64 rounded border border-neutral-700 bg-neutral-950 p-3 text-[11px] leading-5 text-neutral-300 shadow-xl">
                  <b class="text-white">Orbit:</b> left-drag rotate, right-drag pan, wheel zoom.<br>
                  <b class="text-white">Fly:</b> W/A/S/D move, Q/E descend/ascend, hold right mouse to look, Shift boosts speed. The wheel temporarily changes flight speed.
              </div>
          </details>
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
    hasSelection = input(false);
    
    loadMap = output<number>();
    editModeChange = output<EditMode>();
    saveMap = output<void>();
    addEntity = output<void>();
    focusSelected = output<void>();

    constructor(public renderer: MapRendererService) {}
}
