import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../../services/doom-file.service';
import { DoomTextService, TextEntry } from '../../../services/doom-text.service';
import { EditorService } from '../../../services/editor.service';

@Component({
  selector: 'app-string-reference-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mt-2 rounded border border-neutral-700 bg-neutral-900/70 p-2 text-xs">
      <div class="flex items-center gap-2">
        <span class="font-bold text-amber-400">String #{{ stringId() }}</span>
        <span class="text-neutral-500">chunk {{ chunkId() }} · language {{ langId() }} · {{ encoding() }}</span>
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
      @if (currentEntry(); as entry) {
        <div class="mt-2 rounded border border-neutral-700 bg-black/40 p-2">
          <div class="whitespace-pre-wrap break-words text-neutral-200">{{ entry.raw }}</div>
          <div class="mt-2 flex flex-wrap gap-3">
            <button type="button" class="text-blue-400 hover:text-blue-300" (click)="beginEdit(entry)">Изменить</button>
            <button type="button" class="text-green-400 hover:text-green-300" (click)="beginCopy(entry)">Создать копию</button>
            <button type="button" class="text-amber-400 hover:text-amber-300" (click)="openInTextEditor(entry.id)">Открыть в редакторе строк</button>
          </div>
        </div>
      }
      @if (mode()) {
        <div class="mt-2 border-t border-neutral-700 pt-2">
          <textarea [(ngModel)]="draft" (ngModelChange)="validateDraft()" rows="2"
            class="w-full rounded border border-neutral-600 bg-black p-2 text-white" placeholder="Новий рядок"></textarea>
          <div class="text-[10px] text-neutral-500">Зберігається chunk {{ chunkId() }} для language {{ langId() }}; інші chunks не змінюються.</div>
          @if (encodingError()) { <div class="text-red-400">{{ encodingError() }}</div> }
          @if (saveError()) { <div class="text-red-400">{{ saveError() }}</div> }
          <div class="mt-1 flex justify-end gap-2">
            <button type="button" (click)="cancelDraft()" class="text-neutral-400">Скасувати</button>
            <button type="button" (click)="saveDraft()" [disabled]="!draft || !!encodingError() || saving()"
              class="rounded bg-green-700 px-2 py-1 text-white disabled:opacity-40">{{ mode() === 'edit' ? 'Зберегти' : 'Створити' }}</button>
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
  langId = input.required<number>();
  encoding = input.required<string>();
  selected = output<number>();

  private textService = inject(DoomTextService);
  private fileService = inject(DoomFileService);
  private editorService = inject(EditorService);
  entries = signal<TextEntry[]>([]);
  query = '';
  draft = '';
  mode = signal<'edit' | 'copy' | null>(null);
  saving = signal(false);
  saveError = signal('');
  encodingError = signal('');
  filtered(): TextEntry[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.entries().filter(entry => !query || String(entry.id).includes(query) || entry.raw.toLocaleLowerCase().includes(query));
  }

  constructor() {
    effect(() => {
      const buffer = this.fileService.getFile('strings.idx');
      this.editorService.textResourcesUpdated();
      this.entries.set(buffer ? this.textService.loadStrings(this.langId(), this.chunkId(), this.textService.parseStringsIndex(buffer), this.encoding()) : []);
    });
  }

  currentEntry() { return this.entries().find(entry => entry.id === this.stringId()); }

  beginEdit(entry: TextEntry) { this.mode.set('edit'); this.draft = entry.raw; this.resetErrors(); }
  beginCopy(entry: TextEntry) { this.mode.set('copy'); this.draft = entry.raw; this.resetErrors(); }

  validateDraft() {
    const error = this.textService.validateString(this.draft, this.encoding());
    this.encodingError.set(error ? `Символ “${error.character}” у позиції ${error.position} не підтримується ${error.encoding}.` : '');
  }

  cancelDraft() {
    this.mode.set(null);
    this.draft = '';
    this.resetErrors();
  }

  private resetErrors() { this.encodingError.set(''); this.saveError.set(''); }

  openInTextEditor(stringId: number) { this.editorService.goToString(this.chunkId(), stringId); }

  async saveDraft() {
    this.validateDraft();
    const mode = this.mode();
    if (!mode || !this.draft || this.encodingError()) return;
    this.saving.set(true);
    this.saveError.set('');
    const current = this.entries();
    const targetId = mode === 'edit' ? this.stringId() : this.textService.getNextStringId(current);
    const next = mode === 'edit'
      ? current.map(entry => entry.id === targetId ? { ...entry, raw: this.draft, renderKey: this.draft } : entry)
      : [...current, { id: targetId, raw: this.draft, renderKey: this.draft }];
    try {
      const result = await this.textService.saveStringsChunk(this.langId(), this.chunkId(), next, this.encoding());
      if (!result.success) {
        const error = result.error;
        this.saveError.set(error
          ? `Символ “${error.character}” у позиції ${error.position} не підтримується ${error.encoding}.`
          : 'Не вдалося зберегти chunk.');
        return;
      }
      const buffer = this.fileService.getFile('strings.idx');
      this.entries.set(buffer ? this.textService.loadStrings(this.langId(), this.chunkId(), this.textService.parseStringsIndex(buffer), this.encoding()) : next);
      this.editorService.notifyTextResourceChanged();
      this.selected.emit(targetId);
      this.cancelDraft();
    } catch {
      this.saveError.set('Не вдалося зберегти chunk.');
    } finally {
      this.saving.set(false);
    }
  }
}
