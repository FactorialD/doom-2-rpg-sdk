export type SingleByteEncoding = 'windows-1251' | 'windows-1252';

export interface TextEncodingError {
  kind: 'unrepresentable-character';
  encoding: SingleByteEncoding;
  line: number;
  position: number;
  character: string;
  codePoint: number;
}

export type EncodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: TextEncodingError };

// The first half of both Windows code pages maps bytes directly to Unicode.
const ASCII_AND_CONTROLS = Array.from({ length: 128 }, (_, byte) => byte);

// These strings enumerate bytes 0x80..0xff in byte order. Undefined entries in
// the WHATWG indexes are represented by their corresponding C1 control, making
// every one of the 256 byte values round-trippable rather than silently lossy.
const WINDOWS_1251_HIGH =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї' +
  'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
const WINDOWS_1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ' +
  '\u00a0¡¢£¤¥¦§¨©ª«¬\u00ad®¯°±²³´µ¶·¸¹º»¼½¾¿' +
  'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ';

function makeCodePage(highHalf: string): readonly number[] {
  const highCodePoints = Array.from(highHalf, character => character.codePointAt(0)!);
  if (highCodePoints.length !== 128) {
    throw new Error(`Invalid single-byte code page table (${highCodePoints.length} high bytes)`);
  }
  return [...ASCII_AND_CONTROLS, ...highCodePoints];
}

export const SINGLE_BYTE_CODE_PAGES: Readonly<Record<SingleByteEncoding, readonly number[]>> = {
  'windows-1251': makeCodePage(WINDOWS_1251_HIGH),
  'windows-1252': makeCodePage(WINDOWS_1252_HIGH)
};

const ENCODING_TABLES: Readonly<Record<SingleByteEncoding, ReadonlyMap<number, number>>> = {
  'windows-1251': reverseCodePage(SINGLE_BYTE_CODE_PAGES['windows-1251']),
  'windows-1252': reverseCodePage(SINGLE_BYTE_CODE_PAGES['windows-1252'])
};

function reverseCodePage(codePage: readonly number[]): ReadonlyMap<number, number> {
  return new Map(codePage.map((codePoint, byte) => [codePoint, byte]));
}

export function encodeSingleByte(
  value: string,
  encoding: SingleByteEncoding,
  line: number
): EncodeResult {
  const table = ENCODING_TABLES[encoding];
  const bytes: number[] = [];
  let position = 1;

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const byte = table.get(codePoint);
    if (byte === undefined) {
      return {
        ok: false,
        error: { kind: 'unrepresentable-character', encoding, line, position, character, codePoint }
      };
    }
    bytes.push(byte);
    position++;
  }

  return { ok: true, bytes: Uint8Array.from(bytes) };
}

export function decodeSingleByte(bytes: Uint8Array, encoding: SingleByteEncoding): string {
  const table = SINGLE_BYTE_CODE_PAGES[encoding];
  return Array.from(bytes, byte => String.fromCodePoint(table[byte])).join('');
}
