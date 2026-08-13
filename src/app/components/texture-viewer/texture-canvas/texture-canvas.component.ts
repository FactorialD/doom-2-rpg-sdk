
import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, AfterViewInit, inject, SimpleChanges } from '@angular/core';
import { EditorService } from '../../../services/editor.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TextureInfo, DoomTextureService } from '../../../services/doom-texture.service';
import { ImageProcessingService } from '../../../services/image-processing.service';
import { TextureToolbarComponent, Tool, ImportState } from '../texture-toolbar/texture-toolbar.component';

import { CanvasPoint, firstClipboardImage, isPointerButtonPressed, moveSelectionPixels, rasterizeLine } from './texture-canvas-interaction';
import { readClipboardImage } from '../../../shared/image-clipboard';

@Component({
  selector: 'app-texture-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, TextureToolbarComponent],
  template: `
            <!-- Toolbar -->
            <app-texture-toolbar
                [texture]="texture"
                [isCompressed]="isCompressed"
                [canEdit]="canEdit"
                [hasChanges]="hasChanges"
                [activeTool]="activeTool"
                [brushSize]="brushSize"
                [importState]="importState"
                [bgColor]="bgColor"
                [zoom]="zoom"
                (activeToolChange)="activeTool = $event"
                (brushSizeChange)="brushSize = $event"
                (fileSelected)="onFileSelected($event)"
                (pasteRequested)="pasteFromClipboard()"
                (saveChanges)="saveChanges.emit()"
                (stateChange)="render()"
                (applyImport)="applyImport()"
                (cancelImport)="cancelImport()"
                (exportColor)="exportColor()"
                (exportIndices)="exportIndices()"
                (bgColorChange)="bgColorChange.emit($event)"
                (zoomChange)="zoomChange.emit($event)"
            ></app-texture-toolbar>

            <!-- Canvas Container -->
            <div #scrollContainer tabindex="0" class="flex-1 overflow-auto flex items-center justify-center p-8 bg-neutral-950 custom-scrollbar outline-none"
                 (paste)="onPaste($event)">
                <div *ngIf="texture" class="border border-white/20 shadow-2xl relative cursor-crosshair checkerboard"
                     [style.--checker-color]="bgColor" [style.--checker-light]="checkerLightColor">
                     <canvas #canvas class="block image-pixelated bg-transparent"
                        [style.width.px]="texture.width * zoom"
                        [style.height.px]="texture.height * zoom"
                        [style.cursor]="cursorStyle"
                        (pointerdown)="startDrawing($event)"
                        (pointermove)="draw($event)"
                        (pointerup)="stopDrawing($event)"
                        (pointercancel)="stopDrawing($event)"
                        (lostpointercapture)="onLostPointerCapture($event)"
                     ></canvas>
                </div>
            </div>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
    .image-pixelated { image-rendering: pixelated; }
    .checkerboard {
      background-color: var(--checker-color);
      background-image:
        linear-gradient(45deg, var(--checker-light) 25%, transparent 25%),
        linear-gradient(-45deg, var(--checker-light) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, var(--checker-light) 75%),
        linear-gradient(-45deg, transparent 75%, var(--checker-light) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }
  `]
})
export class TextureCanvasComponent implements OnChanges, AfterViewInit {
    @Input() texture: TextureInfo | null = null;
    @Input() zoom: number = 4;
    @Input() bgColor: string = '#8a8a8a';
    @Input() canEdit: boolean = false;
    @Input() hasChanges: boolean = false;
    @Input() rawData: Uint8Array | null = null;
    @Input() paletteColors: string[] = []; 
    @Input() paletteRaw: Uint32Array | undefined; 
    @Input() selectedColorIndex: number = 0;
    @Input() isCompressed: boolean = false;
    @Input() paletteVersion: number = 0; // Trigger redraw when palette updates

    @Output() zoomChange = new EventEmitter<number>();
    @Output() bgColorChange = new EventEmitter<string>();
    @Output() saveChanges = new EventEmitter<void>();
    @Output() pixelChanged = new EventEmitter<{index: number, colorIndex: number}>();

    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('scrollContainer') scrollContainerRef!: ElementRef<HTMLElement>;
    
    private textureService = inject(DoomTextureService);
    private imgProcessor = inject(ImageProcessingService);
    private editorService = inject(EditorService);
    private activePointerId: number | null = null;
    private activeButton = 0;
    private lastStrokePoint: (CanvasPoint & { pointerId: number }) | null = null;

    activeTool: Tool = 'pencil';
    brushSize: number = 3;
    isDrawing = false;
    cursorStyle = 'crosshair';

    selection: { x: number; y: number; width: number; height: number } | null = null;
    private selectionDrag: {
        mode: 'create' | 'move'; startX: number; startY: number;
        originX: number; originY: number; snapshot: Uint8Array;
    } | null = null;

    get checkerLightColor(): string {
        const hex = this.bgColor.replace('#', '');
        const value = Number.parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
        if (!Number.isFinite(value)) return '#d8d8d8';
        const brighten = (channel: number) => Math.min(255, channel + Math.max(48, Math.round((255 - channel) * .42)));
        return `rgb(${brighten(value >> 16 & 255)}, ${brighten(value >> 8 & 255)}, ${brighten(value & 255)})`;
    }
    
    // Import State
    importState: ImportState = {
        active: false,
        img: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        bgOpacity: 0.5,
        imgOpacity: 0.8,
        scalingMode: 'nearest'
    };

    // Dragging state for Import Move/Scale
    dragState = {
        isDragging: false,
        mode: 'none' as 'none' | 'move' | 'nw' | 'ne' | 'sw' | 'se',
        startX: 0,
        startY: 0,
        startImportX: 0,
        startImportY: 0,
        startImportW: 0,
        startImportH: 0
    };

    ngOnChanges(changes: SimpleChanges) {
        // If texture changed, reset import state
        if (changes['texture']) {
            this.selection = null;
            this.selectionDrag = null;
            if (this.importState.active && (this.texture?.width !== this.importState.img?.width)) {
                 this.cancelImport();
            }
        }
        // Force render on any change (zoom, palette, raw data)
        this.render();
    }

    ngAfterViewInit() {
        this.render();
    }

    /**
     * Renders the current state to the canvas. 
     */
    render() {
        if (!this.canvasRef || !this.texture) return;
        const canvas = this.canvasRef.nativeElement;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        // Resize canvas to texture dimensions (not zoom dimensions)
        if (canvas.width !== this.texture.width) canvas.width = this.texture.width;
        if (canvas.height !== this.texture.height) canvas.height = this.texture.height;
        
        ctx.clearRect(0, 0, this.texture.width, this.texture.height);

        // 1. Render Base Texture (Existing Data)
        if (this.rawData && this.paletteRaw) {
            // If importing, respect background opacity
            ctx.globalAlpha = this.importState.active ? this.importState.bgOpacity : 1.0;

            const imgData = new ImageData(this.texture.width, this.texture.height);
            const pixels = new Uint32Array(imgData.data.buffer);
            const palette = this.paletteRaw;
            const index0IsTransparent = this.textureService.isIndex0Transparent(this.texture.id);

            for(let i=0; i < this.rawData.length; i++) {
                const colorIdx = this.rawData[i];
                if (colorIdx < palette.length) {
                     if (colorIdx === 0 && index0IsTransparent) { 
                         pixels[i] = 0x00000000; 
                    } else {
                         pixels[i] = palette[colorIdx];
                    }
                } else {
                    pixels[i] = 0xFF000000 | colorIdx;
                }
            }
            ctx.putImageData(imgData, 0, 0);
        } else {
            // Draw error placeholder
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, this.texture.width, this.texture.height);
        }

        // 2. Render Import Overlay (if active)
        if (this.importState.active && this.importState.img && this.paletteRaw) {
            ctx.globalAlpha = this.importState.imgOpacity;
            
            // Generate the palette-matched preview through the same pipeline as Apply.
            const tempCanvas = document.createElement('canvas');
            const { imageData: sourceData, indices } = this.createImportIndices();
            tempCanvas.width = sourceData.width;
            tempCanvas.height = sourceData.height;
            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
                const previewImg = new ImageData(sourceData.width, sourceData.height);
                const previewPixels = new Uint32Array(previewImg.data.buffer);
                const palette = this.paletteRaw;
                const index0Trans = this.textureService.isIndex0Transparent(this.texture.id);
                
                for(let i=0; i<indices.length; i++) {
                    const idx = indices[i];
                    if (idx === 0 && index0Trans) {
                        previewPixels[i] = 0;
                    } else {
                        previewPixels[i] = palette[idx];
                    }
                }
                
                // 4. Draw preview to main canvas
                // We use putImageData, but putImageData ignores globalAlpha and doesn't handle transparency compositing well on top of existing content in the same way drawImage does.
                // So we put it on a temp canvas and draw that.
                tempCtx.putImageData(previewImg, 0, 0);
                
                // Enable pixelated scaling
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(tempCanvas, this.importState.x, this.importState.y);
            }

            // Draw Controls Overlay (Always Opaque)
            ctx.globalAlpha = 1.0;
            
            // Dotted box
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(this.importState.x, this.importState.y, this.importState.width, this.importState.height);
            ctx.setLineDash([]); // Reset
            
            // Resize Handles
            const handleSize = 4; // texture pixels size
            const ix = this.importState.x;
            const iy = this.importState.y;
            const iw = this.importState.width;
            const ih = this.importState.height;
            
            ctx.fillStyle = '#00FF00';
            // NW
            ctx.fillRect(ix, iy, handleSize, handleSize);
            // NE
            ctx.fillRect(ix + iw - handleSize, iy, handleSize, handleSize);
            // SW
            ctx.fillRect(ix, iy + ih - handleSize, handleSize, handleSize);
            // SE
            ctx.fillRect(ix + iw - handleSize, iy + ih - handleSize, handleSize, handleSize);
        }

        if (this.selection) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 1]);
            ctx.strokeRect(this.selection.x + .5, this.selection.y + .5, this.selection.width, this.selection.height);
            ctx.setLineDash([]);
        }

        // Reset alpha
        ctx.globalAlpha = 1.0;
    }

    startDrawing(event: PointerEvent) {
        if (!this.texture || event.button < 0) return;
        this.activePointerId = event.pointerId;
        this.activeButton = event.button;
        (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
        
        if (this.importState.active) {
            this.handleImportStart(event);
            return;
        }
        
        if (!this.canEdit) return;

        if (this.activeTool === 'select') {
            this.handleSelectionStart(event);
            return;
        }
        
        if (this.activeTool === 'fill') {
            this.handleFill(event);
        } else {
            this.isDrawing = true;
            const point = this.getCanvasCoords(event);
            this.lastStrokePoint = { ...point, pointerId: event.pointerId };
            this.paintStrokeBatch([point]);
        }
    }
    
    stopDrawing(event?: PointerEvent) {
        if (event && this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
        if (this.selectionDrag) {
            this.selectionDrag = null;
            if (this.selection?.width === 0 || this.selection?.height === 0) this.selection = null;
            this.render();
        }
        this.isDrawing = false;
        this.dragState.isDragging = false;
        this.dragState.mode = 'none';
        if (event && (event.currentTarget as Element).hasPointerCapture?.(event.pointerId)) {
            (event.currentTarget as Element).releasePointerCapture(event.pointerId);
        }
        this.activePointerId = null;
        this.lastStrokePoint = null;
    }

    onLostPointerCapture(event: PointerEvent) {
        if (event.pointerId === this.activePointerId) this.stopDrawing();
    }
    
    draw(event: PointerEvent) {
        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
        if (this.activePointerId !== null && event.pointerId === this.activePointerId && !isPointerButtonPressed(event, this.activeButton)) {
            this.stopDrawing(event);
            return;
        }
        if (this.activePointerId !== null) this.autoScroll(event);
        if (this.importState.active) {
            this.handleImportDrag(event);
            return;
        }

        if (this.activeTool === 'select' && this.selectionDrag) {
            this.handleSelectionDrag(event);
            return;
        }

        if (!this.isDrawing || !this.canEdit || !this.texture || !this.rawData) return;
        
        const samples = typeof event.getCoalescedEvents === 'function'
            ? [...event.getCoalescedEvents(), event]
            : [event];
        const points: CanvasPoint[] = [];
        let previous = this.lastStrokePoint?.pointerId === event.pointerId
            ? this.lastStrokePoint
            : this.getCanvasCoords(samples[0]);
        for (const sample of samples) {
            const current = this.getCanvasCoords(sample);
            const segment = rasterizeLine(previous, current);
            points.push(...segment.slice(points.length === 0 ? 0 : 1));
            previous = current;
        }
        this.lastStrokePoint = { ...previous, pointerId: event.pointerId };
        this.paintStrokeBatch(points);
    }

    private paintStrokeBatch(points: CanvasPoint[]) {
        let changed = false;
        for (const point of points) {
            changed = (this.activeTool === 'pencil'
                ? this.plot(point.x, point.y)
                : this.activeTool === 'brush' && this.paintBrush(point.x, point.y)) || changed;
        }
        if (!changed) return;
        this.pixelChanged.emit({ index: 0, colorIndex: this.selectedColorIndex });
        this.hasChanges = true;
        this.render();
    }

    private handleSelectionStart(event: PointerEvent) {
        if (!this.texture || !this.rawData) return;
        const point = this.getCanvasCoords(event);
        const current = this.selection;
        const inside = !!current && point.x >= current.x && point.x < current.x + current.width
            && point.y >= current.y && point.y < current.y + current.height;
        this.selectionDrag = {
            mode: inside ? 'move' : 'create', startX: point.x, startY: point.y,
            originX: current?.x ?? point.x, originY: current?.y ?? point.y,
            snapshot: new Uint8Array(this.rawData)
        };
        if (!inside) this.selection = { x: point.x, y: point.y, width: 1, height: 1 };
        this.cursorStyle = inside ? 'move' : 'crosshair';
        this.render();
    }

    private handleSelectionDrag(event: PointerEvent) {
        if (!this.texture || !this.rawData || !this.selection || !this.selectionDrag) return;
        const point = this.getCanvasCoords(event);
        const drag = this.selectionDrag;
        if (drag.mode === 'create') {
            const x = Math.max(0, Math.min(drag.startX, point.x));
            const y = Math.max(0, Math.min(drag.startY, point.y));
            this.selection = {
                x, y,
                width: Math.min(this.texture.width, Math.max(drag.startX, point.x) + 1) - x,
                height: Math.min(this.texture.height, Math.max(drag.startY, point.y) + 1) - y
            };
            this.render();
            return;
        }

        const old = { ...this.selection, x: drag.originX, y: drag.originY };
        const nextX = drag.originX + point.x - drag.startX;
        const nextY = drag.originY + point.y - drag.startY;
        this.rawData.set(moveSelectionPixels(drag.snapshot, this.texture.width, this.texture.height, old, nextX, nextY));
        this.selection = { ...old, x: nextX, y: nextY };
        this.pixelChanged.emit({ index: 0, colorIndex: this.rawData[0] });
        this.hasChanges = true;
        this.render();
    }
    
    // Plots a single pixel
    plot(x: number, y: number): boolean {
        if (!this.texture || !this.rawData || x < 0 || x >= this.texture.width || y < 0 || y >= this.texture.height) return false;
        const idx = y * this.texture.width + x;
        if (idx < this.rawData.length && this.rawData[idx] !== this.selectedColorIndex) {
            this.rawData[idx] = this.selectedColorIndex;
            return true;
        }
        return false;
    }
    
    // Paints a circle for the brush
    paintBrush(centerX: number, centerY: number): boolean {
        if (!this.texture || !this.rawData) return false;
        
        const radius = Math.floor(this.brushSize / 2);
        const radiusSq = radius * radius;
        const w = this.texture.width;
        const h = this.texture.height;
        
        // Bounding box for the circle
        const minX = Math.max(0, centerX - radius);
        const maxX = Math.min(w - 1, centerX + radius);
        const minY = Math.max(0, centerY - radius);
        const maxY = Math.min(h - 1, centerY + radius);
        
        let changed = false;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                // Circular check
                const dx = x - centerX;
                const dy = y - centerY;
                // Add 0.5 for smoother circle edge on small sizes
                if (dx*dx + dy*dy <= radiusSq + (radius > 1 ? 0.5 : 0)) {
                    const idx = y * w + x;
                    if (this.rawData[idx] !== this.selectedColorIndex) {
                        this.rawData[idx] = this.selectedColorIndex;
                        changed = true;
                    }
                }
            }
        }
        
        return changed;
    }

    // --- Import Interaction ---

    handleImportStart(event: PointerEvent) {
        const { x, y } = this.getCanvasCoords(event);
        
        const handleSize = 4; // texture pixels
        const { x: ix, y: iy, width: iw, height: ih } = this.importState;

        // Helper to check rect collision
        const inRect = (rx: number, ry: number, rw: number, rh: number) => {
            return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
        };

        let mode: 'none' | 'nw' | 'ne' | 'sw' | 'se' | 'move' = 'none';

        // Check Corners (Order doesn't matter much as they shouldn't overlap if image is big enough)
        // Hit area slightly larger (handleSize + 2) for easier clicking
        if (inRect(ix, iy, handleSize, handleSize)) mode = 'nw';
        else if (inRect(ix + iw - handleSize, iy, handleSize, handleSize)) mode = 'ne';
        else if (inRect(ix, iy + ih - handleSize, handleSize, handleSize)) mode = 'sw';
        else if (inRect(ix + iw - handleSize, iy + ih - handleSize, handleSize, handleSize)) mode = 'se';
        else if (inRect(ix, iy, iw, ih)) mode = 'move';

        if (mode !== 'none') {
            this.dragState = {
                isDragging: true,
                mode: mode,
                startX: x, startY: y,
                startImportX: ix, startImportY: iy,
                startImportW: iw, startImportH: ih
            };
        }
    }

    handleImportDrag(event: PointerEvent) {
        const { x, y } = this.getCanvasCoords(event);
        
        const handleSize = 4;
        const { x: ix, y: iy, width: iw, height: ih } = this.importState;

        // Hover Cursor Update
        if (!this.dragState.isDragging) {
             const inRect = (rx: number, ry: number, rw: number, rh: number) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
             
             if (inRect(ix, iy, handleSize, handleSize)) this.cursorStyle = 'nwse-resize';
             else if (inRect(ix + iw - handleSize, iy, handleSize, handleSize)) this.cursorStyle = 'nesw-resize';
             else if (inRect(ix, iy + ih - handleSize, handleSize, handleSize)) this.cursorStyle = 'nesw-resize';
             else if (inRect(ix + iw - handleSize, iy + ih - handleSize, handleSize, handleSize)) this.cursorStyle = 'nwse-resize';
             else if (inRect(ix, iy, iw, ih)) this.cursorStyle = 'move';
             else this.cursorStyle = 'default';
             
             return;
        }

        // Apply Drag
        const dx = x - this.dragState.startX;
        const dy = y - this.dragState.startY;
        const s = this.dragState;

        switch (this.dragState.mode) {
            case 'move':
                this.importState.x = Math.round(s.startImportX + dx);
                this.importState.y = Math.round(s.startImportY + dy);
                break;

            case 'se': // Bottom-Right: x,y fixed. w,h change.
                this.importState.width = Math.max(1, s.startImportW + dx);
                this.importState.height = Math.max(1, s.startImportH + dy);
                break;

            case 'sw': // Bottom-Left: y, right-edge fixed. x, w, h change.
                // New Width = Old Width - dx. 
                const newW_sw = Math.max(1, s.startImportW - dx);
                // New X = Old X + (Old W - New W) = Old X + dx (if width didn't clamp)
                this.importState.x = s.startImportX + (s.startImportW - newW_sw);
                this.importState.width = newW_sw;
                this.importState.height = Math.max(1, s.startImportH + dy);
                break;

            case 'ne': // Top-Right: x, bottom-edge fixed. y, w, h change.
                const newH_ne = Math.max(1, s.startImportH - dy);
                this.importState.y = s.startImportY + (s.startImportH - newH_ne);
                this.importState.height = newH_ne;
                this.importState.width = Math.max(1, s.startImportW + dx);
                break;

            case 'nw': // Top-Left: bottom-edge, right-edge fixed. x, y, w, h change.
                const newW_nw = Math.max(1, s.startImportW - dx);
                const newH_nw = Math.max(1, s.startImportH - dy);
                this.importState.x = s.startImportX + (s.startImportW - newW_nw);
                this.importState.y = s.startImportY + (s.startImportH - newH_nw);
                this.importState.width = newW_nw;
                this.importState.height = newH_nw;
                break;
        }
        
        this.render();
    }

    handleFill(event: PointerEvent) {
        if (!this.texture || !this.rawData) return;
        const { x, y } = this.getCanvasCoords(event);
        
        if (x < 0 || x >= this.texture.width || y < 0 || y >= this.texture.height) return;
        
        const targetIndex = y * this.texture.width + x;
        const targetColor = this.rawData[targetIndex];
        const replaceColor = this.selectedColorIndex;
        
        if (targetColor === replaceColor) return;
        
        // Stack-based flood fill
        const stack: number[] = [targetIndex];
        const width = this.texture.width;
        const height = this.texture.height;
        const max = width * height;
        
        let processed = 0;

        while(stack.length > 0 && processed < max) {
            const idx = stack.pop()!;
            
            if (this.rawData[idx] === targetColor) {
                this.rawData[idx] = replaceColor;
                processed++;
                
                const cx = idx % width;
                
                // Left
                if (cx > 0 && this.rawData[idx - 1] === targetColor) stack.push(idx - 1);
                // Right
                if (cx < width - 1 && this.rawData[idx + 1] === targetColor) stack.push(idx + 1);
                // Up
                if (idx >= width && this.rawData[idx - width] === targetColor) stack.push(idx - width);
                // Down
                if (idx < max - width && this.rawData[idx + width] === targetColor) stack.push(idx + width);
            }
        }
        
        this.pixelChanged.emit({index: 0, colorIndex: this.rawData[0]});
        this.hasChanges = true;
        this.render();
    }

    private getCanvasCoords(event: PointerEvent): {x: number, y: number} {
        if (!this.texture) return {x: -1, y: -1};
        const rect = this.canvasRef.nativeElement.getBoundingClientRect();
        const scaleX = this.texture.width / rect.width;
        const scaleY = this.texture.height / rect.height;
        return {
            x: Math.floor((event.clientX - rect.left) * scaleX),
            y: Math.floor((event.clientY - rect.top) * scaleY)
        };
    }

    // --- Import / Export ---

    async onFileSelected(file: Blob) {
        await this.beginImport(file);
    }

    async pasteFromClipboard() {
        try { await this.beginImport(await readClipboardImage()); }
        catch (error) { this.editorService.notify('error', (error as Error).message); }
    }

    async onPaste(event: ClipboardEvent) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
        const file = firstClipboardImage(Array.from(event.clipboardData?.items ?? []));
        if (!file) {
            this.editorService.notify('error', 'Clipboard does not contain an image.');
            return;
        }
        event.preventDefault();
        await this.beginImport(file);
    }

    private async beginImport(blob: Blob) {
        if (!this.texture) return;
        try {
            const img = await this.decodeImage(blob);
            this.importState = {
                active: true, img, x: 0, y: 0,
                width: this.texture.width, height: this.texture.height,
                bgOpacity: 0.5, imgOpacity: 0.8, scalingMode: 'nearest'
            };
            if (img.width < this.texture.width) {
                this.importState.width = img.width;
                this.importState.x = Math.floor((this.texture.width - img.width) / 2);
            }
            if (img.height < this.texture.height) {
                this.importState.height = img.height;
                this.importState.y = Math.floor((this.texture.height - img.height) / 2);
            }
            this.render();
        } catch {
            this.editorService.notify('error', 'Could not decode the clipboard image.');
        }
    }

    private decodeImage(blob: Blob): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decode failed')); };
            img.src = url;
        });
    }

    private autoScroll(event: PointerEvent) {
        const container = this.scrollContainerRef?.nativeElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const edge = 32;
        const speed = 12;
        const dx = event.clientX < rect.left + edge ? -speed : event.clientX > rect.right - edge ? speed : 0;
        const dy = event.clientY < rect.top + edge ? -speed : event.clientY > rect.bottom - edge ? speed : 0;
        if (dx || dy) container.scrollBy({ left: dx, top: dy, behavior: 'auto' });
    }

    cancelImport() {
        this.importState.active = false;
        this.importState.img = null;
        this.dragState.isDragging = false;
        this.cursorStyle = 'crosshair';
        this.render();
    }

    applyImport() {
        if (!this.texture || !this.importState.img || !this.rawData || !this.paletteRaw) return;
        
        const { imageData, indices } = this.createImportIndices();
        const index0IsTransparent = this.textureService.isIndex0Transparent(this.texture.id);
        for (let sourceY = 0; sourceY < imageData.height; sourceY++) {
            const targetY = this.importState.y + sourceY;
            if (targetY < 0 || targetY >= this.texture.height) continue;
            for (let sourceX = 0; sourceX < imageData.width; sourceX++) {
                const targetX = this.importState.x + sourceX;
                if (targetX < 0 || targetX >= this.texture.width) continue;
                const index = indices[sourceY * imageData.width + sourceX];
                if (index === 0 && index0IsTransparent) continue;
                this.rawData[targetY * this.texture.width + targetX] = index;
            }
        }
        this.pixelChanged.emit({index: 0, colorIndex: this.rawData[0]});
        this.hasChanges = true;
        
        this.cancelImport(); // Exit mode
    }

    private createImportIndices(): { imageData: ImageData; indices: Uint8Array } {
        const imageData = this.imgProcessor.scaleImage(
            this.importState.img!, this.importState.width, this.importState.height, this.importState.scalingMode
        );
        return { imageData, indices: this.imgProcessor.mapImageToPalette(imageData, this.paletteRaw!) };
    }

    exportColor() {
        if (!this.texture || !this.canvasRef) return;
        const canvas = this.canvasRef.nativeElement;
        // The canvas currently contains the rendered color image
        this.imgProcessor.triggerDownload(canvas.toDataURL('image/png'), `texture_${this.texture.id}_color.png`);
    }

    exportIndices() {
        if (!this.texture || !this.rawData) return;
        this.imgProcessor.downloadRawIndices(
            this.rawData, 
            this.texture.width, 
            this.texture.height, 
            `texture_${this.texture.id}_indices.png`
        );
    }
}
