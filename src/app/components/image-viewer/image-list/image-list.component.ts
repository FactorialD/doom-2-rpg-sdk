import { Component, input, output } from '@angular/core';

import type { DoomImageResource } from '../../../services/doom-image.service';
import { ImageThumbnailComponent } from '../image-thumbnail/image-thumbnail.component';

@Component({
  selector: 'app-image-list',
  standalone: true,
  imports: [ImageThumbnailComponent],
  template: `
    <aside class="h-full w-72 overflow-auto border-r border-neutral-800 p-2">
      <b class="block p-2 text-white">Images</b>
      @for (image of images(); track image.source + ':' + image.id) {
        <button class="flex w-full gap-2 rounded p-2 text-left hover:bg-neutral-800" [class.bg-red-950]="isSelected(image)" (click)="selected.emit(image)">
          <app-image-thumbnail [image]="image" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ image.source === 'index' ? 'Image #' + image.id : image.path }}</span>
            <small class="block text-neutral-400">{{ image.width }}×{{ image.height }} · {{ image.kind }}</small>
            <small class="block text-neutral-500">{{ image.indexed ? 'indexed' : 'RGBA' }} · {{ image.hasAlpha ? 'alpha' : 'opaque' }}</small>
          </span>
        </button>
      }
    </aside>
  `
})
export class ImageListComponent {
  readonly images = input.required<DoomImageResource[]>();
  readonly active = input<DoomImageResource | null>(null);
  readonly selected = output<DoomImageResource>();
  isSelected(image: DoomImageResource): boolean { return this.active()?.source === image.source && this.active()?.id === image.id; }
}
