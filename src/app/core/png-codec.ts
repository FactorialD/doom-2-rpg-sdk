export type PngColorKind = 'indexed' | 'grayscale' | 'truecolor' | 'grayscale-alpha' | 'truecolor-alpha';
export interface PngInfo { width: number; height: number; bitDepth: number; colorType: number; kind: PngColorKind; indexed: boolean; hasAlpha: boolean; palette?: Uint8Array; transparency?: Uint8Array; }

const signature = [137, 80, 78, 71, 13, 10, 26, 10];

/** Inspects PNG chunks without decoding/re-encoding pixel data, preserving indexed files losslessly. */
export function inspectPng(buffer: ArrayBuffer): PngInfo {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte)) throw new Error('Not a PNG image');
  const view = new DataView(buffer);
  const width = view.getUint32(16), height = view.getUint32(20), bitDepth = bytes[24], colorType = bytes[25];
  if (!width || !height || width > 4096 || height > 4096) throw new Error(`Unsupported PNG dimensions ${width}x${height}`);
  const kinds: Record<number, PngColorKind> = { 0: 'grayscale', 2: 'truecolor', 3: 'indexed', 4: 'grayscale-alpha', 6: 'truecolor-alpha' };
  const kind = kinds[colorType];
  if (!kind) throw new Error(`Unsupported PNG color type ${colorType}`);
  let position = 8, palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  while (position + 12 <= bytes.length) {
    const length = view.getUint32(position); const end = position + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
    if (type === 'PLTE') palette = bytes.slice(position + 8, position + 8 + length);
    if (type === 'tRNS') transparency = bytes.slice(position + 8, position + 8 + length);
    position = end; if (type === 'IEND') break;
  }
  if (colorType === 3 && !palette) throw new Error('Indexed PNG is missing PLTE');
  return { width, height, bitDepth, colorType, kind, indexed: colorType === 3, hasAlpha: colorType === 4 || colorType === 6 || !!transparency?.some(alpha => alpha !== 255), palette, transparency };
}
