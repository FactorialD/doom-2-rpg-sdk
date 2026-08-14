
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TextureInfo } from '../../../services/doom-texture.service';
import type { ImageScalingMode } from '../../../services/image-processing.service';
import { DrawingToolsComponent } from '../../../shared/drawing-tools/drawing-tools.component';
import type { DrawingTool } from '../../../shared/drawing-tools/drawing-tool';
import { EditorActionsComponent } from '../../../shared/editor-actions/editor-actions.component';

export interface ImportState {
    active: boolean;
    img: HTMLImageElement | null;
    x: number;
    y: number;
    width: number;
    height: number;
    bgOpacity: number;
    imgOpacity: number;
    scalingMode: ImageScalingMode;
}

@Component({
  selector: 'app-texture-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule, DrawingToolsComponent, EditorActionsComponent],
  template: `
    <div class="h-14 border-b border-neutral-800 bg-neutral-900 flex items-center px-4 justify-between shrink-0 select-none">
        <div class="flex items-center gap-4">
            @if(texture) {
                <!-- Basic Info -->
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-white">#{{ texture.id }}</span>
                        <span class="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400">{{ texture.category }}</span>
                        @if(isCompressed) {
                           <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-900 text-blue-200" title="Compressed (Index 0 is Transparent)">COMP</span>
                        } @else {
                           <span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-500" title="Raw (Opaque)">RAW</span>
                        }
                    </div>
                    <span class="text-[10px] text-neutral-500">{{ texture.width }} x {{ texture.height }} px</span>
                </div>
                
                <div class="h-8 w-px bg-neutral-700 mx-2"></div>

                <!-- Editor Tools -->
                @if(canEdit && !importState.active) {
                    <div class="flex items-center gap-2">
                        <app-drawing-tools [tool]="activeTool" [brushSize]="brushSize" (toolChange)="activeToolChange.emit($event)" (brushSizeChange)="brushSizeChange.emit($event)" />
                    </div>

                    <label class="flex items-center gap-2 cursor-pointer bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs px-3 py-1.5 rounded transition-colors border border-neutral-700 ml-2">
                        <span>📤</span>
                        <span class="font-bold">Import</span>
                        <input type="file" accept="image/*" class="hidden" (change)="onFileSelected($event)" />
                    </label>
                    <button (click)="pasteRequested.emit()" class="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs px-3 py-1.5 rounded border border-neutral-700"><span>📋</span><span class="font-bold">Paste from clipboard</span></button>

                    <app-editor-actions [dirty]="hasChanges" (save)="saveChanges.emit()" (discard)="discardChanges.emit()" />
                    
                    @if(hasChanges) {
                        <span class="text-xs text-amber-500 italic">Modified</span>
                    }
                } @else if (importState.active) {
                    <!-- Import Mode Controls -->
                    <div class="flex items-center gap-3 bg-blue-900/20 border border-blue-900/50 px-3 py-1 rounded">
                        <div class="flex flex-col gap-1">
                            <div class="flex gap-2">
                                <label class="text-[10px] text-blue-200">X <input type="number" [(ngModel)]="importState.x" (ngModelChange)="stateChange.emit()" class="w-10 bg-black border border-blue-800 text-white text-xs px-1"></label>
                                <label class="text-[10px] text-blue-200">Y <input type="number" [(ngModel)]="importState.y" (ngModelChange)="stateChange.emit()" class="w-10 bg-black border border-blue-800 text-white text-xs px-1"></label>
                            </div>
                            <div class="flex gap-2">
                                <label class="text-[10px] text-blue-200">W <input type="number" [(ngModel)]="importState.width" (ngModelChange)="stateChange.emit()" class="w-10 bg-black border border-blue-800 text-white text-xs px-1"></label>
                                <label class="text-[10px] text-blue-200">H <input type="number" [(ngModel)]="importState.height" (ngModelChange)="stateChange.emit()" class="w-10 bg-black border border-blue-800 text-white text-xs px-1"></label>
                            </div>
                        </div>
                        
                        <div class="flex flex-col gap-1 w-24 border-l border-blue-900/50 pl-2">
                             <div class="flex justify-between text-[10px] text-blue-200"><span>Orig</span> <span>{{ (importState.bgOpacity * 100).toFixed(0) }}%</span></div>
                             <input type="range" min="0" max="1" step="0.1" [(ngModel)]="importState.bgOpacity" (ngModelChange)="stateChange.emit()" class="h-1 accent-blue-500">
                             
                             <div class="flex justify-between text-[10px] text-green-200 mt-1"><span>New</span> <span>{{ (importState.imgOpacity * 100).toFixed(0) }}%</span></div>
                             <input type="range" min="0" max="1" step="0.1" [(ngModel)]="importState.imgOpacity" (ngModelChange)="stateChange.emit()" class="h-1 accent-green-500">
                        </div>

                        <label class="flex flex-col gap-1 border-l border-blue-900/50 pl-2 text-[10px] text-blue-200">
                            Scaling
                            <select [(ngModel)]="importState.scalingMode" (ngModelChange)="stateChange.emit()" class="bg-black border border-blue-800 text-white text-xs px-1 py-0.5">
                                <option value="nearest">Nearest neighbor</option>
                                <option value="bilinear">Bilinear</option>
                                <option value="high-quality">High quality</option>
                            </select>
                        </label>

                        <div class="flex flex-col gap-1">
                            <button (click)="applyImport.emit()" class="px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded font-bold">Apply</button>
                            <button (click)="cancelImport.emit()" class="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 text-white text-xs rounded">Cancel</button>
                        </div>
                    </div>
                }

                <div class="h-8 w-px bg-neutral-700 mx-2"></div>
                
                <!-- Export Actions -->
                <div class="flex gap-1">
                     <button (click)="exportColor.emit()" class="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-xs text-white rounded border border-neutral-700" title="Download Color PNG">
                        ⬇ Color
                     </button>
                     <button (click)="exportIndices.emit()" class="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-xs text-white rounded border border-neutral-700" title="Download Raw Indices (Grayscale)">
                        ⬇ Raw
                     </button>
                </div>
            }
        </div>

        <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 border-r border-neutral-700 pr-3">
                <span class="text-xs uppercase font-bold text-neutral-500">Checker</span>
                <input type="color" [ngModel]="bgColor" (ngModelChange)="bgColorChange.emit($event)" class="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0" title="Transparency checker color">
            </div>
            
            <div class="flex items-center gap-2">
                <span class="text-xs uppercase font-bold text-neutral-500">Zoom</span>
                <select [ngModel]="zoom" (ngModelChange)="zoomChange.emit(+$event)" class="bg-neutral-800 border border-neutral-700 text-xs rounded px-1 py-0.5 outline-none focus:border-red-600 text-white">
                    <option [value]="1">1x</option>
                    <option [value]="2">2x</option>
                    <option [value]="4">4x</option>
                    <option [value]="8">8x</option>
                </select>
            </div>
        </div>
    </div>
  `,
   styles: [`
    input[type=number]::-webkit-inner-spin-button, 
    input[type=number]::-webkit-outer-spin-button { 
      -webkit-appearance: none; 
      margin: 0; 
    }
  `]
})
export class TextureToolbarComponent {
    @Input() texture: TextureInfo | null = null;
    @Input() isCompressed: boolean = false;
    @Input() canEdit: boolean = false;
    @Input() hasChanges: boolean = false;
    @Input() activeTool: DrawingTool = 'pencil';
    @Input() brushSize: number = 3;
    @Input() importState!: ImportState;
    @Input() bgColor: string = '#111111';
    @Input() zoom: number = 4;

    @Output() activeToolChange = new EventEmitter<DrawingTool>();
    @Output() brushSizeChange = new EventEmitter<number>();
    @Output() fileSelected = new EventEmitter<File>();
    @Output() pasteRequested = new EventEmitter<void>();
    @Output() saveChanges = new EventEmitter<void>();
    @Output() discardChanges = new EventEmitter<void>();
    @Output() stateChange = new EventEmitter<void>(); // When sliders/inputs change
    @Output() applyImport = new EventEmitter<void>();
    @Output() cancelImport = new EventEmitter<void>();
    @Output() exportColor = new EventEmitter<void>();
    @Output() exportIndices = new EventEmitter<void>();
    @Output() bgColorChange = new EventEmitter<string>();
    @Output() zoomChange = new EventEmitter<number>();

    onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            this.fileSelected.emit(input.files[0]);
        }
        input.value = '';
    }
}
