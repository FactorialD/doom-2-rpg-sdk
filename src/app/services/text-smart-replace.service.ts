import { Injectable } from '@angular/core';

export type SmartReplaceMatchMode = 'exact' | 'similar';

export interface SmartReplaceSource {
  langId: number;
  chunkId: number;
  stringId: number;
  raw: string;
  searchStart?: number;
  searchEnd?: number;
}

export interface SmartReplaceCandidate {
  key: string;
  langId: number;
  chunkId: number;
  stringId: number;
  rawStart: number;
  rawEnd: number;
  before: string;
  after: string;
  context: string;
  originalRaw: string;
  enabled: boolean;
  distance: number;
}

interface NormalizedText {
  text: string;
  ranges: Array<{ start: number; end: number }>;
}

@Injectable({ providedIn: 'root' })
export class TextSmartReplaceService {
  normalize(value: string, caseSensitive = false, normalizeHyphens = true): NormalizedText {
    let text = '';
    const ranges: NormalizedText['ranges'] = [];
    for (let i = 0; i < value.length;) {
      const codePoint = value.codePointAt(i)!;
      const char = String.fromCodePoint(codePoint);
      const end = i + char.length;
      if (normalizeHyphens && char === '-') {
        if (value[end] === '-') {
          text += '-';
          ranges.push({ start: i, end: end + 1 });
          i = end + 1;
        } else {
          i = end;
        }
        continue;
      }
      const normalizedChar = caseSensitive ? char : char.toLocaleLowerCase();
      for (const normalizedCodePoint of normalizedChar) {
        text += normalizedCodePoint;
        ranges.push({ start: i, end });
      }
      i = end;
    }
    return { text, ranges };
  }

  buildCandidates(
    sources: readonly SmartReplaceSource[],
    find: string,
    replacement: string,
    options: { mode: SmartReplaceMatchMode; caseSensitive: boolean; normalizeHyphens: boolean },
  ): SmartReplaceCandidate[] {
    const needle = this.normalize(find, options.caseSensitive, options.normalizeHyphens).text;
    if (!needle) return [];
    const candidates: SmartReplaceCandidate[] = [];
    for (const source of sources) {
      const start = source.searchStart ?? 0;
      const end = source.searchEnd ?? source.raw.length;
      const normalized = this.normalize(source.raw.slice(start, end), options.caseSensitive, options.normalizeHyphens);
      const matches = options.mode === 'exact'
        ? this.exactMatches(normalized.text, needle)
        : this.similarMatches(normalized.text, needle);
      for (const match of matches) {
        const first = normalized.ranges[match.start];
        const last = normalized.ranges[match.end - 1];
        if (!first || !last) continue;
        const rawStart = start + first.start;
        const rawEnd = start + last.end;
        const before = source.raw.slice(rawStart, rawEnd);
        candidates.push({
          key: `${source.langId}:${source.chunkId}:${source.stringId}:${rawStart}:${rawEnd}`,
          langId: source.langId, chunkId: source.chunkId, stringId: source.stringId,
          rawStart, rawEnd, before, after: replacement,
          context: source.raw.slice(Math.max(0, rawStart - 24), Math.min(source.raw.length, rawEnd + 24)),
          originalRaw: source.raw, enabled: true, distance: match.distance,
        });
      }
    }
    return candidates;
  }

  validate(candidates: readonly SmartReplaceCandidate[], currentRaw: (candidate: SmartReplaceCandidate) => string | undefined): string | null {
    const grouped = new Map<string, SmartReplaceCandidate[]>();
    for (const candidate of candidates.filter(item => item.enabled)) {
      const raw = currentRaw(candidate);
      if (raw === undefined || raw !== candidate.originalRaw || raw.slice(candidate.rawStart, candidate.rawEnd) !== candidate.before) {
        return `String ${candidate.stringId} changed after the preview was built.`;
      }
      const group = `${candidate.langId}:${candidate.chunkId}:${candidate.stringId}`;
      grouped.set(group, [...(grouped.get(group) ?? []), candidate]);
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => a.rawStart - b.rawStart);
      if (group.some((candidate, index) => index > 0 && candidate.rawStart < group[index - 1].rawEnd)) {
        return 'Selected replacement ranges overlap.';
      }
    }
    return null;
  }

  apply(raw: string, candidates: readonly SmartReplaceCandidate[]): string {
    return candidates.filter(item => item.enabled).sort((a, b) => b.rawStart - a.rawStart)
      .reduce((value, item) => value.slice(0, item.rawStart) + item.after + value.slice(item.rawEnd), raw);
  }

  private exactMatches(haystack: string, needle: string) {
    const result: Array<{ start: number; end: number; distance: number }> = [];
    for (let start = 0; start <= haystack.length - needle.length;) {
      const found = haystack.indexOf(needle, start);
      if (found < 0) break;
      result.push({ start: found, end: found + needle.length, distance: 0 });
      start = found + Math.max(1, needle.length);
    }
    return result;
  }

  private similarMatches(haystack: string, needle: string) {
    const threshold = Math.max(1, Math.floor(needle.length * 0.25));
    const words = [...haystack.matchAll(/[\p{L}\p{N}_-]+/gu)];
    return words.map(match => ({
      start: match.index, end: match.index + match[0].length,
      distance: this.levenshtein(match[0], needle),
    })).filter(match => match.distance <= threshold);
  }

  private levenshtein(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  }
}
