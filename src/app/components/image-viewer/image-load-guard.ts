export interface ImageLoadRequest { token: number; archiveRevision: number }

/** Identifies asynchronous image work that still belongs to the active archive and selection. */
export class ImageLoadGuard {
  private token = 0;

  begin(archiveRevision: number): ImageLoadRequest {
    return { token: ++this.token, archiveRevision };
  }

  invalidate(): void {
    this.token++;
  }

  isCurrent(request: ImageLoadRequest, archiveRevision: number): boolean {
    return request.token === this.token && request.archiveRevision === archiveRevision;
  }
}
