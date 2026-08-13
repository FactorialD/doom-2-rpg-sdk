import { Component, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { DoomFileService } from "../../services/doom-file.service";
import {
  DoomTextService,
  SaveStringsResult,
} from "../../services/doom-text.service";
import { StringsListComponent } from "./strings-list/strings-list.component";
import { FontAtlasComponent } from "./font-atlas/font-atlas.component";
import { EditorService } from "../../services/editor.service";
import { SidebarPanelComponent } from "../../shared/components/sidebar-panel/sidebar-panel.component";
import { TextResourceSettingsService } from "../../services/text-resource-settings.service";
import { SmartReplaceCandidate, SmartReplaceMatchMode, TextSmartReplaceService } from "../../services/text-smart-replace.service";
import { TextSelectionEvent } from "./strings-list/strings-list.component";

@Component({
  selector: "app-text-viewer",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StringsListComponent,
    FontAtlasComponent,
    SidebarPanelComponent,
  ],
  template: `
    <div class="flex h-full w-full">
      <!-- Left Sidebar (Settings) -->
      <app-sidebar-panel widthClass="w-64">
        <div class="p-4 border-b border-neutral-800">
          <h2 class="text-white font-bold mb-4">Text Resources</h2>

          @if (!fileService.isLoaded()) {
            <div
              class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50"
            >
              Load a JAR file via the top toolbar to view resources.
            </div>
          }

          <!-- Filters -->
          @if (hasIndex()) {
            <div class="space-y-4 animate-fade-in">
              <div class="text-xs font-bold text-neutral-500 uppercase">
                Filters
              </div>

              <div>
                <label class="text-xs text-neutral-400 block mb-1"
                  >Language</label
                >
                <select
                  [ngModel]="selectedLang()"
                  (ngModelChange)="selectLanguage(+$event)"
                  class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600"
                >
                  <option [value]="0">English</option>
                  <option [value]="1">French</option>
                  <option [value]="2">German</option>
                  <option [value]="3">Italian</option>
                  <option [value]="4">Spanish</option>
                </select>
              </div>

              <div>
                <label class="text-xs text-neutral-400 block mb-1"
                  >Encoding</label
                >
                <select
                  [ngModel]="selectedEncoding()"
                  (ngModelChange)="selectEncoding($event)"
                  class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600"
                >
                  <option value="windows-1252">Western (Windows-1252)</option>
                  <option value="windows-1251">Cyrillic (Windows-1251)</option>
                  <option value="utf-8">UTF-8</option>
                </select>
                <p class="text-[10px] text-neutral-500 mt-1">
                  Use 'Cyrillic' for Russian mods.
                </p>
              </div>

              <div>
                <label class="text-xs text-neutral-400 block mb-1"
                  >Chunk ID (0-14)</label
                >
                <select
                  [ngModel]="selectedChunk()"
                  (ngModelChange)="selectChunk(+$event)"
                  class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600"
                >
                  @for (chunk of chunks; track chunk.id) {
                    <option [value]="chunk.id">
                      {{ chunk.name }} ({{ chunk.id }})
                    </option>
                  }
                </select>
              </div>
            </div>
            <div class="mt-5 pt-4 border-t border-neutral-800 space-y-2">
              <div class="text-xs font-bold text-neutral-300 uppercase">Smart Replace</div>
              <input [(ngModel)]="replaceFind" placeholder="Find or select text" class="w-full bg-neutral-800 text-white text-xs p-2 rounded">
              <input [(ngModel)]="replaceWith" placeholder="Replace with" class="w-full bg-neutral-800 text-white text-xs p-2 rounded">
              <select [(ngModel)]="replaceScope" class="w-full bg-neutral-800 text-white text-xs p-2 rounded">
                <option value="selection">Current string / selection</option>
                <option value="chunk">Current chunk</option>
                <option value="all">All loaded language chunks</option>
              </select>
              <div class="grid grid-cols-2 gap-1 text-[10px] text-neutral-300">
                <label><input type="checkbox" [(ngModel)]="caseSensitive"> Case-sensitive</label>
                <label><input type="checkbox" [(ngModel)]="normalizeHyphens"> Normalize hyphens</label>
              </div>
              <select [(ngModel)]="matchMode" class="w-full bg-neutral-800 text-white text-xs p-2 rounded">
                <option value="exact">Exact match</option><option value="similar">Similar match</option>
              </select>
              <button (click)="buildReplacements()" class="w-full p-2 bg-blue-700 hover:bg-blue-600 rounded text-xs text-white">Find candidates</button>
            </div>
          }
        </div>
      </app-sidebar-panel>

      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden bg-[#1a1a1a]">
        <!-- Sub-tabs -->
        <div class="flex border-b border-neutral-800 bg-neutral-900 px-4">
          <button
            (click)="activeSubTab.set('strings')"
            [class.border-b-2]="activeSubTab() === 'strings'"
            [class.border-red-600]="activeSubTab() === 'strings'"
            [class.text-white]="activeSubTab() === 'strings'"
            class="px-4 py-3 text-xs font-bold text-neutral-400 hover:text-white transition-colors uppercase tracking-wide"
          >
            Strings
          </button>
          <button
            (click)="activeSubTab.set('atlases')"
            [class.border-b-2]="activeSubTab() === 'atlases'"
            [class.border-red-600]="activeSubTab() === 'atlases'"
            [class.text-white]="activeSubTab() === 'atlases'"
            class="px-4 py-3 text-xs font-bold text-neutral-400 hover:text-white transition-colors uppercase tracking-wide"
          >
            Atlases (Font)
          </button>
        </div>

        <!-- Content Area -->
        <div class="flex-1 overflow-hidden relative">
          @if (activeSubTab() === "strings") {
            @if (hasIndex()) {
              @if (replaceCandidates().length) {
                <div class="max-h-52 overflow-y-auto border-b border-neutral-700 bg-neutral-900 p-2 text-xs">
                  <div class="flex gap-2 items-center mb-2">
                    <b>{{ enabledReplacementCount() }} selected</b>
                    <button (click)="setAllCandidates(true)" class="text-blue-400">Select all</button>
                    <button (click)="setAllCandidates(false)" class="text-blue-400">none</button>
                    <button (click)="applyReplacements()" [disabled]="!enabledReplacementCount()" class="ml-auto px-3 py-1 rounded bg-red-700 disabled:bg-neutral-700">Apply</button>
                  </div>
                  @for (candidate of replaceCandidates(); track candidate.key) {
                    <label class="flex gap-2 py-1 border-t border-neutral-800">
                      <input type="checkbox" [ngModel]="candidate.enabled" (ngModelChange)="toggleCandidate(candidate.key, $event)">
                      <span class="font-mono text-neutral-400">L{{candidate.langId}} C{{candidate.chunkId}} #{{candidate.stringId}}</span>
                      <span class="truncate">{{candidate.context}}</span>
                      <span class="ml-auto whitespace-nowrap text-amber-400">“{{candidate.before}}” → “{{candidate.after}}”</span>
                    </label>
                  }
                </div>
              }
              <app-strings-list
                [strings]="currentStrings()"
                [resourceId]="textResourceId()"
                [scrollToId]="targetStringId"
                (onSave)="onSaveCurrentChunk()"
                (selectionChange)="onTextSelection($event)"
              />
            } @else {
              <div
                class="flex flex-col items-center justify-center h-full text-neutral-500"
              >
                <p class="mb-2">Load 'doom2rpg.jar' to view text.</p>
              </div>
            }
          } @else {
            <app-font-atlas />
          }
        </div>
      </div>
    </div>
  `,
})
export class TextViewerComponent {
  fileService = inject(DoomFileService);
  textService = inject(DoomTextService);
  editorService = inject(EditorService);
  textSettings = inject(TextResourceSettingsService);
  smartReplace = inject(TextSmartReplaceService);

  activeSubTab = signal<"strings" | "languages" | "atlases">("strings");

  hasIndex = this.fileService.stringsIndexLoaded;

  selectedLang = this.textSettings.langId;
  selectedChunk = signal(0);
  selectedEncoding = this.textSettings.encoding;
  textResourceId = computed(() => `${this.selectedLang()}:${this.selectedChunk()}`);

  // For auto-scrolling
  targetStringId: number = -1;
  replaceFind = '';
  replaceWith = '';
  replaceScope: 'selection' | 'chunk' | 'all' = 'selection';
  matchMode: SmartReplaceMatchMode = 'exact';
  caseSensitive = false;
  normalizeHyphens = true;
  replaceCandidates = signal<SmartReplaceCandidate[]>([]);
  enabledReplacementCount = computed(() => this.replaceCandidates().filter(candidate => candidate.enabled).length);
  private selection: TextSelectionEvent | null = null;
  private replacementEntries = new Map<string, ReturnType<DoomTextService['loadStrings']>>();

  chunks = [
    { id: 0, name: "Code Strings" },
    { id: 1, name: "Entity Strings" },
    { id: 2, name: "File Strings" },
    { id: 3, name: "Menu Strings" },
    { id: 4, name: "Map 01 (Intro/Lab)" },
    { id: 5, name: "Map 02" },
    { id: 6, name: "Map 03" },
    { id: 7, name: "Map 04" },
    { id: 8, name: "Map 05" },
    { id: 9, name: "Map 06" },
    { id: 10, name: "Map 07" },
    { id: 11, name: "Map 08" },
    { id: 12, name: "Map 09" },
    { id: 13, name: "Map Test" },
    { id: 14, name: "Translations" },
  ];

  currentStrings = computed(() => {
    // IMPORTANT: We depend on both hasIndex AND isLoaded.
    // hasIndex might trigger early when strings.idx loads, but stringsX.bin files might not be ready.
    // isLoaded ensures the full JAR load is complete.
    if (!this.hasIndex() || !this.fileService.isLoaded()) return [];

    const idxBuffer = this.fileService.getFile("strings.idx");
    if (!idxBuffer) return [];

    try {
      const idxData = this.textService.parseStringsIndex(idxBuffer);
      return this.textService.loadStrings(
        this.selectedLang(),
        this.selectedChunk(),
        idxData,
        this.selectedEncoding(),
      );
    } catch (e) {
      console.error("Error loading strings:", e);
      return [];
    }
  });

  constructor() {
    effect(() => {
      const req = this.editorService.requestedTextNavigation();
      if (req) {
        if (!this.editorService.confirmResourceChange('strings', `${this.selectedLang()}:${req.chunkId}`)) {
          this.editorService.requestedTextNavigation.set(null);
          return;
        }
        this.activeSubTab.set("strings");
        this.selectedChunk.set(req.chunkId);
        // Trigger scroll
        this.targetStringId = req.stringId;
      }
    });
  }

  async onSaveCurrentChunk() {
    const strings = this.currentStrings();
    if (!strings.length) return;

    console.log("Saving chunk...");
    const result: SaveStringsResult = await this.textService.saveStringsChunk(
      this.selectedLang(),
      this.selectedChunk(),
      strings,
      this.selectedEncoding(),
    );

    if (result.success === true) {
      this.editorService.notifyTextResourceChanged();
      this.editorService.clearDirty('strings', this.textResourceId());
      this.editorService.notify('success', 'Strings saved to memory.');
    } else if (result.success === false && result.error) {
      const error = result.error;
      this.editorService.notify('error',
        `Cannot encode line ${error.line}, position ${error.position}: "${error.character}" is not representable in ${error.encoding}.`,
      );
    } else {
      this.editorService.notify('error', 'Failed to save strings. Check console.');
    }
  }

  selectLanguage(id: number) {
    if (this.editorService.confirmResourceChange('strings', `${id}:${this.selectedChunk()}`)) { this.replaceCandidates.set([]); this.selection = null; this.selectedLang.set(id); }
  }

  selectChunk(id: number) {
    if (this.editorService.confirmResourceChange('strings', `${this.selectedLang()}:${id}`)) { this.replaceCandidates.set([]); this.selection = null; this.selectedChunk.set(id); }
  }

  selectEncoding(encoding: string) {
    if (this.editorService.isDirty('strings') && !confirm('Changing encoding will reload this edited text. Discard unsaved changes?')) return;
    this.editorService.clearDirty('strings');
    this.selectedEncoding.set(encoding as 'windows-1251' | 'windows-1252' | 'utf-8');
  }

  onTextSelection(selection: TextSelectionEvent) {
    this.selection = selection;
    if (selection.text) this.replaceFind = selection.text;
  }

  buildReplacements() {
    const idxBuffer = this.fileService.getFile('strings.idx');
    if (!idxBuffer || !this.replaceFind) { this.replaceCandidates.set([]); return; }
    const index = this.textService.parseStringsIndex(idxBuffer);
    this.replacementEntries.clear();
    const coordinates: Array<[number, number]> = this.replaceScope === 'all'
      ? Array.from({ length: 5 * 15 }, (_, index) => [Math.floor(index / 15), index % 15] as [number, number])
      : [[this.selectedLang(), this.selectedChunk()]];
    const sources = coordinates.flatMap(([langId, chunkId]) => {
      const entries = langId === this.selectedLang() && chunkId === this.selectedChunk()
        ? this.currentStrings() : this.textService.loadStrings(langId, chunkId, index, this.selectedEncoding());
      this.replacementEntries.set(`${langId}:${chunkId}`, entries);
      return entries.filter(entry => this.replaceScope !== 'selection' || entry.id === this.selection?.id).map(entry => ({
        langId, chunkId, stringId: entry.id, raw: entry.raw,
        searchStart: this.replaceScope === 'selection' && this.selection?.selectionEnd !== this.selection?.selectionStart ? this.selection?.selectionStart : undefined,
        searchEnd: this.replaceScope === 'selection' && this.selection?.selectionEnd !== this.selection?.selectionStart ? this.selection?.selectionEnd : undefined,
      }));
    });
    this.replaceCandidates.set(this.smartReplace.buildCandidates(sources, this.replaceFind, this.replaceWith, {
      mode: this.matchMode, caseSensitive: this.caseSensitive, normalizeHyphens: this.normalizeHyphens,
    }));
  }

  toggleCandidate(key: string, enabled: boolean) {
    this.replaceCandidates.update(items => items.map(item => item.key === key ? { ...item, enabled } : item));
  }

  setAllCandidates(enabled: boolean) {
    this.replaceCandidates.update(items => items.map(item => ({ ...item, enabled })));
  }

  async applyReplacements() {
    const candidates = this.replaceCandidates();
    const getEntry = (candidate: SmartReplaceCandidate) => this.replacementEntries.get(`${candidate.langId}:${candidate.chunkId}`)?.find(entry => entry.id === candidate.stringId);
    const error = this.smartReplace.validate(candidates, candidate => getEntry(candidate)?.raw);
    if (error) { this.editorService.notify('error', error); return; }
    const groups = new Map<string, SmartReplaceCandidate[]>();
    for (const candidate of candidates.filter(item => item.enabled)) {
      const key = `${candidate.langId}:${candidate.chunkId}:${candidate.stringId}`;
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    for (const group of groups.values()) {
      const entry = getEntry(group[0])!;
      entry.raw = this.smartReplace.apply(entry.raw, group);
      entry.renderKey = entry.raw;
      this.editorService.markDirty('strings', `${group[0].langId}:${group[0].chunkId}`);
    }
    const chunks = new Set([...groups.values()].map(group => `${group[0].langId}:${group[0].chunkId}`));
    if (chunks.size > 1) {
      for (const key of chunks) {
        const [langId, chunkId] = key.split(':').map(Number);
        const result = await this.textService.saveStringsChunk(langId, chunkId, this.replacementEntries.get(key)!, this.selectedEncoding());
        if (!result.success) { this.editorService.notify('error', `Could not save replacements in ${key}.`); return; }
      }
      this.editorService.notifyTextResourceChanged();
    }
    this.replaceCandidates.set([]);
    this.editorService.notify('success', `Applied ${groups.size} string replacement${groups.size === 1 ? '' : 's'}.`);
  }
}
