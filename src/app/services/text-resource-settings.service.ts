import { Injectable, signal } from '@angular/core';

export type TextResourceEncoding = 'windows-1251' | 'windows-1252' | 'utf-8';

/** Settings shared by every entry point that reads or writes game text. */
@Injectable({ providedIn: 'root' })
export class TextResourceSettingsService {
  readonly langId = signal(0);
  readonly encoding = signal<TextResourceEncoding>('windows-1252');
}
