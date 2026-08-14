
import { Injectable, signal, WritableSignal } from '@angular/core';
import JSZip from 'jszip';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';
import { downloadBlob } from '../shared/browser-download';

type ZipCompression = 'STORE' | 'DEFLATE';

export interface VfsEntryMetadata {
  date: Date;
  comment: string;
  unixPermissions: number | string | null;
  dosPermissions: number | null;
  dir: boolean;
  order: number;
  compression: ZipCompression;
  compressionOptions: { level: number } | null;
}

export type JarLoadErrorCode =
  | 'INVALID_ARCHIVE'
  | 'ENTRY_READ_FAILED'
  | 'INVALID_RESOURCE_INDEX'
  | 'AMBIGUOUS_RESOURCE_BASENAME';

export class JarLoadError extends Error {
  constructor(
    readonly code: JarLoadErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'JarLoadError';
  }
}

const NEW_ENTRY_DATE = new Date(1980, 0, 1, 0, 0, 0);

export class ResourceCompatibilityError extends JarLoadError {
  constructor(
    readonly resourceName: string,
    readonly conflictingPaths: string[]
  ) {
    super(
      'AMBIGUOUS_RESOURCE_BASENAME',
      `Resource "${resourceName}" is ambiguous: ${conflictingPaths.join(', ')}`
    );
    this.name = 'ResourceCompatibilityError';
  }
}

@Injectable({
  providedIn: 'root'
})
export class DoomFileService {
  // Stores raw ArrayBuffers for files with their FULL paths (e.g., "com/ea/Game.class")
  files: Map<string, ArrayBuffer> = new Map();
  /** ZIP properties kept separately so replacing a payload does not discard its container metadata. */
  entryMetadata: Map<string, VfsEntryMetadata> = new Map();
  private resourcePathsByBasename: Map<string, string[]> = new Map();
  
  // Signal to notify app that a JAR is loaded
  isLoaded: WritableSignal<boolean> = signal(false);
  loadedFileName: WritableSignal<string> = signal('');
  /** Increments only after a replacement archive has been validated and committed. */
  readonly archiveRevision = signal(0);

  // Specific signal for Font image source
  fontImageSrc: WritableSignal<string | null> = signal(null);
  
  // Signal to notify when critical text files are loaded
  stringsIndexLoaded: WritableSignal<boolean> = signal(false);
  
  constructor() {}

  async loadFile(name: string, file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    this.saveBuffer(name, buffer);
  }

  async loadJar(file: File): Promise<void> {
    let phase: JarLoadErrorCode = 'INVALID_ARCHIVE';
    let nextFontUrl: string | null = null;
    let nextFiles: Map<string, ArrayBuffer>;
    let nextEntryMetadata: Map<string, VfsEntryMetadata>;
    let nextResourceIndex: Map<string, string[]>;
    let nextStringsIndexLoaded: boolean;

    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(await file.arrayBuffer());
      nextFiles = new Map<string, ArrayBuffer>();
      nextEntryMetadata = new Map<string, VfsEntryMetadata>();

      const promises: Promise<void>[] = [];

      let order = 0;
      content.forEach((relativePath: string, zipEntry: JSZip.JSZipObject) => {
        const normalizedPath = this.normalizePath(relativePath);
        nextEntryMetadata.set(normalizedPath, this.metadataFromZipEntry(zipEntry, order++));
        if (!zipEntry.dir) {
          const promise = zipEntry.async('arraybuffer').then((buffer: ArrayBuffer) => {
            nextFiles.set(normalizedPath, buffer);
          });
          promises.push(promise);
        }
      });

      phase = 'ENTRY_READ_FAILED';
      await Promise.all(promises);
      phase = 'INVALID_RESOURCE_INDEX';
      nextResourceIndex = this.buildResourceIndex(nextFiles);
      this.validateResourceIndex(nextResourceIndex);
      const nextFontBuffer = this.findFontBuffer(nextFiles, nextResourceIndex);
      nextFontUrl = nextFontBuffer
        ? URL.createObjectURL(new Blob([nextFontBuffer], { type: 'image/png' }))
        : null;
      nextStringsIndexLoaded = this.resolveResourcePathFromIndex('strings.idx', nextResourceIndex) !== undefined;
    } catch (error) {
      if (nextFontUrl) URL.revokeObjectURL(nextFontUrl);
      if (error instanceof JarLoadError) throw error;
      throw new JarLoadError(phase, this.jarLoadErrorMessage(phase), { cause: error });
    }

    const previousFontUrl = this.fontImageSrc();
    this.files = nextFiles;
    this.entryMetadata = nextEntryMetadata;
    this.resourcePathsByBasename = nextResourceIndex;
    this.loadedFileName.set(file.name);
    this.stringsIndexLoaded.set(nextStringsIndexLoaded);
    this.fontImageSrc.set(nextFontUrl);
    this.isLoaded.set(true);
    this.archiveRevision.update(revision => revision + 1);
    if (previousFontUrl && previousFontUrl !== nextFontUrl) URL.revokeObjectURL(previousFontUrl);
    console.log(`Loaded ${this.files.size} files from JAR.`);
  }

  private jarLoadErrorMessage(code: JarLoadErrorCode): string {
    switch (code) {
      case 'ENTRY_READ_FAILED': return 'Failed to read an entry from the ZIP/JAR archive.';
      case 'INVALID_RESOURCE_INDEX': return 'The ZIP/JAR contains an invalid resource index.';
      default: return 'The selected file is not a valid ZIP/JAR archive.';
    }
  }

  // --- EXPORT FUNCTION ---
  async downloadModdedJar() {
    if (!this.isLoaded()) return;

    try {
        const zip = new JSZip();

        // Original entries retain central-directory order; new resources follow in VFS insertion order.
        const paths = new Set([...this.entryMetadata.keys(), ...this.files.keys()]);
        const orderedPaths = [...paths].sort((left, right) =>
          this.metadataFor(left).order - this.metadataFor(right).order
        );
        for (const path of orderedPaths) {
            const metadata = this.metadataFor(path);
            const options: JSZip.JSZipFileOptions = {
              date: new Date(metadata.date),
              comment: metadata.comment,
              unixPermissions: metadata.unixPermissions,
              dosPermissions: metadata.dosPermissions,
              dir: metadata.dir,
              compression: metadata.compression,
              compressionOptions: metadata.compressionOptions,
              createFolders: false
            };
            if (metadata.dir) {
              zip.file(path, null, { ...options, dir: true });
            } else {
              const buffer = this.files.get(path);
              if (buffer) zip.file(path, buffer, options);
            }
        }

        const platform = [...this.entryMetadata.values()].some(metadata => metadata.unixPermissions !== null)
          ? 'UNIX'
          : 'DOS';
        const blob = await zip.generateAsync({ type: 'blob', platform });
        
        downloadBlob(blob, 'doom2rpg_modded.jar');

    } catch (e) {
        console.error("Failed to pack JAR", e);
        alert("Failed to create JAR file.");
    }
  }

  saveBuffer(path: string, buffer: ArrayBuffer) {
    const normalizedPath = this.normalizePath(path);
    const targetPath = normalizedPath.includes('/')
      ? normalizedPath
      : this.resolveResourcePath(normalizedPath) ?? normalizedPath;
    this.files.set(targetPath, buffer);
    if (!this.entryMetadata.has(targetPath)) {
      this.entryMetadata.set(targetPath, this.newEntryMetadata());
    }
    this.rebuildResourceIndex();

    this.updateStringsIndexLoaded();
    
    if (this.basename(targetPath) === 'font.png') {
        const blob = new Blob([buffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        this.setFontImageSrc(url);
    }
  }

  /** Resolves every destination before committing a group of related files. */
  saveBuffersAtomically(buffers: ReadonlyMap<string, ArrayBuffer>): void {
    this.updateBuffersAtomically(buffers, []);
  }

  /** Resolves all paths first, then applies related updates and deletions as one VFS mutation. */
  updateBuffersAtomically(buffers: ReadonlyMap<string, ArrayBuffer>, deletes: readonly string[]): void {
    const resolved = [...buffers].map(([path, buffer]) => {
      const normalized = this.normalizePath(path);
      const target = normalized.includes('/') ? normalized : this.resolveResourcePath(normalized) ?? normalized;
      return [target, buffer] as const;
    });
    const resolvedDeletes = deletes.map(path => {
      const normalized = this.normalizePath(path);
      return normalized.includes('/') ? normalized : this.resolveResourcePath(normalized) ?? normalized;
    });
    for (const path of resolvedDeletes) {
      this.files.delete(path);
      this.entryMetadata.delete(path);
    }
    for (const [path, buffer] of resolved) {
      this.files.set(path, buffer);
      if (!this.entryMetadata.has(path)) this.entryMetadata.set(path, this.newEntryMetadata());
    }
    this.rebuildResourceIndex();
    this.updateStringsIndexLoaded();
  }

  getFile(name: string): ArrayBuffer | undefined {
    const key = this.normalizePath(name);
    const resourcePath = key.includes('/') ? key : this.resolveResourcePath(key);
    return resourcePath ? this.files.get(resourcePath) : undefined;
  }

  getFilesByPrefix(prefix: string): Map<string, ArrayBuffer> {
    const result = new Map<string, ArrayBuffer>();
    const cleanPrefix = prefix.startsWith('/') ? prefix.substring(1) : prefix;
    
    for (const [key, val] of this.files.entries()) {
      if (key.startsWith(cleanPrefix)) {
        result.set(key, val);
      }
    }
    return result;
  }

  private findFontBuffer(
    files: ReadonlyMap<string, ArrayBuffer>,
    index: ReadonlyMap<string, string[]>
  ): ArrayBuffer | undefined {
      const getFile = (name: string): ArrayBuffer | undefined => {
        const path = this.resolveResourcePathFromIndex(name, index);
        return path ? files.get(path) : undefined;
      };
      const directFont = getFile('font.png');
      const idxBuffer = getFile('images.idx');
      if (!idxBuffer) return directFont;

      const indexData = flattenResourceFileIndex(parseResourceFileIndex(idxBuffer));
      const FONT_ID = 11;
      const STRIDE = 3;
      const pos = FONT_ID * STRIDE;
      
      if (pos + 2 < indexData.length) {
          const chunkId = indexData[pos];
          const offset = indexData[pos + 1];
          const length = indexData[pos + 2];
          
          if (chunkId !== 255 && length > 0) {
              const binName = `images${chunkId}.bin`;
              const binBuffer = getFile(binName);
              
              if (binBuffer && offset + length <= binBuffer.byteLength) {
                  return binBuffer.slice(offset, offset + length);
              }
          }
      }
      return directFont;
  }

  private normalizePath(path: string): string {
    return path.replace(/^\/+/, '');
  }

  private metadataFromZipEntry(entry: JSZip.JSZipObject, order: number): VfsEntryMetadata {
    // JSZip exposes the input compression only on its loaded compressed-data object.
    const compressedData = (entry as JSZip.JSZipObject & {
      _data?: { compression?: { magic?: string } };
    })._data;
    const compression = compressedData?.compression?.magic === '\x08\x00' ? 'DEFLATE' : 'STORE';
    return {
      date: new Date(entry.date),
      comment: entry.comment ?? '',
      unixPermissions: entry.unixPermissions,
      dosPermissions: entry.dosPermissions,
      dir: entry.dir,
      order,
      compression,
      // The ZIP format does not record the encoder's DEFLATE level, so it cannot be recovered.
      compressionOptions: null
    };
  }

  private metadataFor(path: string): VfsEntryMetadata {
    const existing = this.entryMetadata.get(path);
    if (existing) return existing;
    const metadata = this.newEntryMetadata();
    this.entryMetadata.set(path, metadata);
    return metadata;
  }

  private newEntryMetadata(): VfsEntryMetadata {
    return {
      date: new Date(NEW_ENTRY_DATE),
      comment: '',
      unixPermissions: null,
      dosPermissions: null,
      dir: false,
      order: this.entryMetadata.size,
      compression: 'STORE',
      compressionOptions: null
    };
  }

  private basename(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  private rebuildResourceIndex(): void {
    this.resourcePathsByBasename = this.buildResourceIndex(this.files);
  }

  private buildResourceIndex(files: ReadonlyMap<string, ArrayBuffer>): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const path of files.keys()) {
      const basename = this.basename(path);
      const paths = index.get(basename) ?? [];
      paths.push(path);
      index.set(basename, paths);
    }
    return index;
  }

  private validateResourceIndex(index: ReadonlyMap<string, string[]>): void {
    for (const [basename, paths] of index) {
      if (paths.length > 1) {
        throw new ResourceCompatibilityError(basename, [...paths].sort());
      }
    }
  }

  private resolveResourcePath(basename: string): string | undefined {
    return this.resolveResourcePathFromIndex(basename, this.resourcePathsByBasename);
  }

  private resolveResourcePathFromIndex(
    basename: string,
    index: ReadonlyMap<string, string[]>
  ): string | undefined {
    const paths = index.get(basename) ?? [];
    if (paths.length > 1) {
      throw new ResourceCompatibilityError(basename, [...paths].sort());
    }
    return paths[0];
  }

  private setFontImageSrc(url: string | null): void {
    const previousUrl = this.fontImageSrc();
    if (previousUrl && previousUrl !== url) {
      URL.revokeObjectURL(previousUrl);
    }
    this.fontImageSrc.set(url);
  }

  private updateStringsIndexLoaded(): void {
    try {
      this.stringsIndexLoaded.set(this.getFile('strings.idx') !== undefined);
    } catch (error) {
      this.stringsIndexLoaded.set(false);
      throw error;
    }
  }

}
