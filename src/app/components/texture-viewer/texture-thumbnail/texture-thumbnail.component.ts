
import { Component, Input, ViewChild, ElementRef, inject, OnChanges, AfterViewInit, ChangeDetectionStrategy, SimpleChanges } from '@angular/core';
import { DoomTextureService } from '../../../services/doom-texture.service';
import { TexturePaletteService } from '../../../services/textures/texture-palette.service';
import { effect } from '@angular/core';

@Component({
  selector: 'app-texture-thumbnail',
  standalone: true,
  template: `
    <canvas #canvas 
      class="block image-pixelated"
      style="max-width: 100%; max-height: 100%; width: auto; height: auto;">
    </canvas>
  `,
  styles: [`
    .image-pixelated { image-rendering: pixelated; }
    :host { 
        display: flex; 
        width: 100%; 
        height: 100%; 
        justify-content: center; 
        align-items: center; 
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextureThumbnailComponent implements OnChanges, AfterViewInit {
  @Input() id!: number;
  @Input() width!: number;
  @Input() height!: number;
  @Input() forceRefresh: number = 0; 

  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private textureService = inject(DoomTextureService);
  private paletteService = inject(TexturePaletteService);

  constructor() {
      // Listen to global updates
      effect(() => {
          this.paletteService.version(); // Refresh on palette change
          this.textureService.textureVersion(); // Refresh on texture change
          
          if (this.canvasRef) {
              this.render();
          }
      });
  }

  ngOnChanges(changes: SimpleChanges) {
     this.render();
  }

  ngAfterViewInit() {
      this.render();
  }

  render() {
     if (!this.canvasRef) return;
     const canvas = this.canvasRef.nativeElement;
     
     if (this.width && this.height) {
         if (canvas.width !== this.width) canvas.width = this.width;
         if (canvas.height !== this.height) canvas.height = this.height;
     }

     const ctx = canvas.getContext('2d');
     if (!ctx) return;
     
     // This fetches the image data constructed from raw indices + current palette
     const imgData = this.textureService.getTextureImageData(this.id);
     
     if (imgData) {
         if (!this.width || !this.height) {
             if (canvas.width !== imgData.width) canvas.width = imgData.width;
             if (canvas.height !== imgData.height) canvas.height = imgData.height;
         } else {
             ctx.clearRect(0, 0, canvas.width, canvas.height);
         }
         ctx.putImageData(imgData, 0, 0);
     } else {
         ctx.clearRect(0, 0, canvas.width, canvas.height);
     }
  }
}
