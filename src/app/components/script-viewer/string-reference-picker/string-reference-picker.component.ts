import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../../services/doom-file.service';
import { DoomTextService, TextEntry } from '../../../services/doom-text.service';

@Component({
  selector: 'app-string-reference-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mt-2 rounded border border-neutral-700 bg-neutral-900/70 p-2 text-xs">
      <div class="flex items-center gap-2">
        <span class="font-bold text-amber-400">String #{{ stringId() }}</span>
        <span class="text-neutral-500">chunk {{ chunkId() }} · language 0 · {{ encoding() }}</span>
        <button type="button" class="ml-auto text-green-400 hover:text-green-300" (click)="creating.set(true)">Створити рядок</button>
      </div>
      <input class="mt-2 w-full rounded border border-neutral-700 bg-black px-2 py-1 text-white"
        placeholder="Search by ID or text" [(ngModel)]="query" />
      <div class="mt-1 max-h-32 overflow-y-auto">
        @for (entry of filtered(); track entry.id) {
          <button type="button" (click)="selected.emit(entry.id)"
            class="block w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-700">
            <span class="font-mono text-neutral-500">#{{ entry.id }}</span> {{ entry.raw }}
          </button>
        }
      </div>
      @if (creating()) {
        <div class="mt-2 border-t border-neutral-700 pt-2">
          <textarea [(ngModel)]="draft" (ngModelChange)="validateDraft()" rows="2"
            class="w-full rounded border border-neutral-600 bg-black p-2 text-white" placeholder="Новий рядок"></textarea>
          <div class="text-[10px] text-neutral-500">Записується лише language 0; інші мовні chunks не змінюються.</div>
          @if (encodingError()) { <div class="text-red-400">{{ encodingError() }}</div> }
          @if (saveError()) { <div class="text-red-400">Не вдалося зберегти chunk.</div> }
          <div class="mt-1 flex justify-end gap-2">
            <button type="button" (click)="cancelCreate()" class="text-neutral-400">Скасувати</button>
            <button type="button" (click)="create()" [disabled]="!draft || !!encodingError() || saving()"
              class="rounded bg-green-700 px-2 py-1 text-white disabled:opacity-40">Створити</button>
          </div>
        </div>
      }
    </div>
  `
})
export class StringReferencePickerComponent {
  chunkId = input.required<number>();
  stringId = input.required<number>();
  mapId = input.required<number>();
  encoding = input('windows-1252');
  selected = output<number>();

  private textService = inject(DoomTextService);
  private fileService = inject(DoomFileService);
  entries = signal<TextEntry[]>([]);
  query = '';
  draft = '';
  creating = signal(false);
  saving = signal(false);
  saveError = signal(false);
  encodingError = signal('');
  filtered(): TextEntry[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.entries().filter(entry => !query || String(entry.id).includes(query) || entry.raw.toLocaleLowerCase().includes(query));
  }

  constructor() {
    effect(() => {
      const buffer = this.fileService.getFile('strings.idx');
      this.entries.set(buffer ? this.textService.loadStrings(0, this.chunkId(), this.textService.parseStringsIndex(buffer), this.encoding()) : []);
    });
  }

  validateDraft() {
    const error = this.textService.validateString(this.draft, this.encoding());
    this.encodingError.set(error ? `Символ “${error.character}” у позиції ${error.position} не підтримується ${error.encoding}.` : '');
  }

  cancelCreate() {
    this.creating.set(false);
    this.draft = '';
    this.encodingError.set('');
    this.saveError.set(false);
  }

  async create() {
    this.validateDraft();
    if (!this.draft || this.encodingError()) return;
    this.saving.set(true);
    const result = await this.textService.createString(0, this.chunkId(), this.draft, this.encoding());
    this.saving.set(false);
    if (!result.success) { this.saveError.set(true); return; }
    this.entries.update(entries => [...entries, result.entry]);
    this.selected.emit(result.entry.id);
    this.cancelCreate();
  }
}
