import {
  decodeSingleByte,
  encodeSingleByte,
  SINGLE_BYTE_CODE_PAGES,
  type SingleByteEncoding
} from '../src/app/services/single-byte-codec.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function roundTrip(value: string, encoding: SingleByteEncoding): void {
  const encoded = encodeSingleByte(value, encoding, 1);
  assert(encoded.ok, `${encoding} unexpectedly rejected the round-trip fixture`);
  assert(decodeSingleByte(encoded.bytes, encoding) === value, `${encoding} round trip changed text`);
}

assert(SINGLE_BYTE_CODE_PAGES['windows-1251'].length === 256, 'Windows-1251 table is incomplete');
assert(SINGLE_BYTE_CODE_PAGES['windows-1252'].length === 256, 'Windows-1252 table is incomplete');
roundTrip('\x00 ASCII controls\x1f~', 'windows-1251');
roundTrip('АБВЭЮЯабвэюя Ёё Ђђ Єє Її № „“”–—…', 'windows-1251');
roundTrip('ASCII € ‚ƒ ŠŒŽ ‘“”•–— ™ šœžŸ ¡£©½ÿ', 'windows-1252');
roundTrip('\u0081\u008d\u008f\u0090\u009d', 'windows-1252');

const emoji = encodeSingleByte('ok 😀', 'windows-1251', 7);
assert(!emoji.ok, 'Emoji must not be silently truncated');
assert(emoji.error.line === 7, 'Error has the wrong line');
assert(emoji.error.position === 4, 'Error must count Unicode code points');
assert(emoji.error.character === '😀', 'Error has the wrong character');
assert(emoji.error.codePoint === 0x1f600, 'Error has the wrong code point');
