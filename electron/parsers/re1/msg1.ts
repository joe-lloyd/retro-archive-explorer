// RE1 room messages (the `message.msg` section at RDT offset 0x74).
//
// The section is `u16 offset[count]` followed by message bodies. Offsets are
// measured from the start of the table, and `count = offset[0] / 2` (a room
// with no messages has a zero word there). The engine
// picks a body with `msg_id & 0x3F` (bit 6 selects the game's own global
// table instead), so a room holds at most 64 messages. A body is a byte
// stream the message renderer (UpdateMessageDisplay in the Resident Evil PC
// decomp, src/game/Rendering.cpp) walks one byte at a time:
//
//   00 0C-15 1D-36 3D-56 ...  glyphs (space, digits, A-Z, a-z, punctuation)
//   01 nn      end of message: nn = 0 waits for the player, N auto-dismisses after N frames
//   02         newline
//   03 nn      page break: nn = 0 waits for the player, N continues after N frames
//   04 nn      text speed. `04 00` opens a span that is skipped up to the next
//              `04 nn`, which sets the speed
//   05 c       text colour (CLUT)
//   06 i       item name (0 = the selected item), read up to the name's 07
//   07         end of an item name
//   08         Yes/No prompt
//   F8-FA nn   extra glyph pages
//
// The decomp's docs/TEXT_ENCODING.md swaps 02 and 03 in its tag table; the
// renderer is the authority.
//
// Text form: every byte is either a printable character or an escape, so no
// byte is lost. Escapes follow the decomp's STR() macro (src/game/PrintText.h)
// where it has one. STR() reads an operand from the next character; here an
// operand is written `{N}` (decimal 0-255) so the text stays readable.
//
//   \n  02    newline            \p{N} 03 N  page break      \s{N} 04 N  speed
//   \r  07    end of item name   \c    08    Yes/No prompt   \q    0A    square glyph
//   \o  78    opening quote      \t{N} 05 N  text colour     \m{N} 06 N  item name
//   \i  05 01 06 00 05 00: the selected item's name in green
//   \d{N}     last in the text: end of message with auto-dismiss after N frames
//   \xNN      any other byte (F8-FA must be followed by a second \xNN)
//
// A plain `"` is the closing quote (19); `\o` is the opening one.

const END = 0x01;
const PAGE = 0x03;
const SPEED = 0x04;
const EXTENDED = [0xf8, 0xf9, 0xfa];
const SELECTED_ITEM = [0x05, 0x01, 0x06, 0x00, 0x05, 0x00];
const SPAN_OPEN = 0;
/** msg_id & 0x3F selects the message, so the engine cannot reach more than 64. */
export const MAX_MESSAGES = 64;

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Text <-> byte maps for the glyphs that have an ASCII spelling. */
const GLYPH_CHARS = new Map<number, string>([
  [0x00, ' '], [0x16, ':'], [0x17, ';'], [0x18, ','], [0x19, '"'], [0x1a, '!'], [0x1b, '?'],
  [0x37, '('], [0x38, '/'], [0x39, ')'], [0x3a, "'"], [0x3b, '-'], [0x79, '.'],
]);
for (let i = 0; i < 10; i++) GLYPH_CHARS.set(0x0c + i, String.fromCharCode(0x30 + i));
for (let i = 0; i < 26; i++) {
  GLYPH_CHARS.set(0x1d + i, String.fromCharCode(0x41 + i));
  GLYPH_CHARS.set(0x3d + i, String.fromCharCode(0x61 + i));
}
const CHAR_GLYPHS = new Map([...GLYPH_CHARS].map(([byte, ch]) => [ch, byte]));

/** One-byte controls spelled `\n`, `\r`, `\c`, `\q`, `\o`. */
const SIMPLE_ESCAPES = new Map<number, string>([[0x02, 'n'], [0x07, 'r'], [0x08, 'c'], [0x0a, 'q'], [0x78, 'o']]);
const ESCAPE_BYTES = new Map([...SIMPLE_ESCAPES].map(([byte, letter]) => [letter, byte]));
/** Controls that take one operand byte, spelled `\p{N}`, `\s{N}`, `\t{N}`, `\m{N}`. */
const OPERAND_ESCAPES = new Map<number, string>([[0x03, 'p'], [0x04, 's'], [0x05, 't'], [0x06, 'm']]);
const OPERAND_BYTES = new Map([...OPERAND_ESCAPES].map(([byte, letter]) => [letter, byte]));

/** A bad message. `position` is a byte offset when decoding and a 0-based character index when encoding. */
export class MessageError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
    this.name = 'MessageError';
  }
}

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  return prefix.every((b, k) => bytes[at + k] === b);
}

/**
 * Decode the message body at `at` to text. `next` is the offset after its end
 * marker. `limit` bounds the read; a body that does not end before it is an error.
 */
export function decodeMessage(bytes: Uint8Array, at: number, limit = bytes.length): { text: string; next: number } {
  let text = '';
  let i = at;
  // Inside a `04 00 ... 04 nn` span the engine skips bytes rather than acting on them.
  let skipping = false;
  const operand = (): number => {
    if (i + 1 >= limit) throw new MessageError(`byte ${hex2(bytes[i])} at ${i} has no operand before the end of the data`, i);
    return bytes[i + 1];
  };
  while (i < limit) {
    const b = bytes[i];
    if (startsWith(bytes, i, SELECTED_ITEM) && i + SELECTED_ITEM.length <= limit) {
      text += '\\i';
      i += SELECTED_ITEM.length;
    } else if (b === END && !skipping) {
      const frames = operand();
      return { text: frames === 0 ? text : `${text}\\d{${frames}}`, next: i + 2 };
    } else if (b === PAGE && skipping) {
      text += '\\x03';
      i += 1;
    } else if (OPERAND_ESCAPES.has(b)) {
      const n = operand();
      text += `\\${OPERAND_ESCAPES.get(b)}{${n}}`;
      if (b === SPEED) skipping = !skipping && n === SPAN_OPEN;
      i += 2;
    } else if (SIMPLE_ESCAPES.has(b)) {
      text += `\\${SIMPLE_ESCAPES.get(b)}`;
      i += 1;
    } else if (EXTENDED.includes(b)) {
      text += `\\x${hex2(b)}\\x${hex2(operand())}`;
      i += 2;
    } else {
      text += GLYPH_CHARS.get(b) ?? `\\x${hex2(b)}`;
      i += 1;
    }
  }
  throw new MessageError(`message at ${at} has no end marker before byte ${limit}`, at);
}

/** One message as stored: its text and the exact bytes of its body, end marker included. */
export interface RawMessage {
  /** Where the body starts, from the start of the section. */
  offset: number;
  text: string;
  bytes: Uint8Array;
}

/** Read every message of a section whose first byte is the start of the offset table. */
export function readMessageSection(section: Uint8Array): RawMessage[] {
  if (section.length < 2) throw new MessageError('message section is too small to hold an offset table', 0);
  const dv = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const tableSize = dv.getUint16(0, true);
  const count = tableSize / 2;
  // Rooms without messages carry a zero word where the table would start.
  if (tableSize % 2 !== 0 || tableSize > section.length || count > MAX_MESSAGES) {
    throw new MessageError(`first message offset ${tableSize} is not a table of 0-${MAX_MESSAGES} entries`, 0);
  }
  return Array.from({ length: count }, (_, k) => {
    const start = dv.getUint16(k * 2, true);
    if (start < tableSize) throw new MessageError(`message ${k} starts at ${start}, inside the offset table`, k * 2);
    const { text, next } = decodeMessage(section, start);
    return { offset: start, text, bytes: section.subarray(start, next) };
  });
}

function textError(text: string, at: number, what: string): MessageError {
  return new MessageError(`${what} at character ${at + 1} of ${JSON.stringify(text)}`, at);
}

/** Encode message text to a body ending in `01 nn`. */
export function encodeMessage(text: string): Uint8Array {
  const out: number[] = [];
  let skipping = false;
  let dismissAfter = 0;
  let i = 0;
  const hexByte = (at: number): number => {
    const digits = text.slice(at + 2, at + 4);
    if (!/^[0-9a-fA-F]{2}$/.test(digits) || text[at] !== '\\' || text[at + 1] !== 'x') {
      throw textError(text, at, `expected \\xNN (two hex digits)`);
    }
    return parseInt(digits, 16);
  };
  const braced = (at: number, name: string): { value: number; end: number } => {
    const m = /^\{(\d+)\}/.exec(text.slice(at + 2));
    if (!m) throw textError(text, at, `\\${name} needs an operand written {N}`);
    const value = Number(m[1]);
    if (value > 0xff) throw textError(text, at, `\\${name} operand ${value} is not a byte (0-255)`);
    return { value, end: at + 2 + m[0].length };
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch !== '\\') {
      const byte = CHAR_GLYPHS.get(ch);
      if (byte === undefined) {
        throw textError(text, i, ch === '\n' ? 'raw line break (write \\n)' : `character ${JSON.stringify(ch)} has no glyph`);
      }
      out.push(byte);
      i += 1;
      continue;
    }
    const letter = text[i + 1];
    if (letter === undefined) throw textError(text, i, 'backslash at the end of the text');
    const simple = ESCAPE_BYTES.get(letter);
    const withOperand = OPERAND_BYTES.get(letter);
    if (simple !== undefined) {
      out.push(simple);
      i += 2;
    } else if (letter === 'i') {
      out.push(...SELECTED_ITEM);
      i += 2;
    } else if (letter === 'd') {
      const { value, end } = braced(i, 'd');
      if (skipping) throw textError(text, i, '\\d inside a skipped span');
      if (end !== text.length) throw textError(text, end, '\\d must be the last thing in the text');
      dismissAfter = value;
      i = end;
    } else if (withOperand !== undefined) {
      const { value, end } = braced(i, letter);
      if (withOperand === PAGE && skipping) throw textError(text, i, '\\p inside a skipped span');
      out.push(withOperand, value);
      if (withOperand === SPEED) skipping = !skipping && value === SPAN_OPEN;
      i = end;
    } else if (letter === 'x') {
      const byte = hexByte(i);
      // Inside a skipped span a lone 03 or 01 is just a byte; everywhere else they have structure.
      const loneInSpan = skipping && (byte === END || byte === PAGE);
      const named = SIMPLE_ESCAPES.get(byte) ?? OPERAND_ESCAPES.get(byte);
      if (named !== undefined && !loneInSpan) throw textError(text, i, `byte ${hex2(byte)} is written \\${named}`);
      if (byte === END && !loneInSpan) throw textError(text, i, 'byte 01 is the end marker, which is implied');
      out.push(byte);
      i += 4;
      if (EXTENDED.includes(byte)) {
        out.push(hexByte(i));
        i += 4;
      }
    } else {
      throw textError(text, i, `unknown escape \\${letter}`);
    }
  }
  if (skipping) throw textError(text, text.length, 'skipped span opened by \\s{0} is never closed by a second \\s{N}');
  out.push(END, dismissAfter);
  return Uint8Array.from(out);
}

/** An offset table and the encoded messages. */
export function encodeMessageSection(messages: readonly string[]): Uint8Array {
  if (messages.length > MAX_MESSAGES) {
    throw new MessageError(`a room holds at most ${MAX_MESSAGES} messages, got ${messages.length}`, 0);
  }
  const bodies = messages.map((text, k) => {
    try {
      return encodeMessage(text);
    } catch (err) {
      throw err instanceof MessageError ? new MessageError(`message ${k}: ${err.message}`, err.position) : err;
    }
  });
  const table = messages.length * 2;
  const size = bodies.reduce((n, b) => n + b.length, table);
  if (size > 0xffff) throw new MessageError(`messages take ${size} bytes, the offset table reaches 65535`, 0);
  // With no messages the table is the single zero word retail rooms use.
  const out = new Uint8Array(Math.max(size, 2));
  const dv = new DataView(out.buffer);
  let at = table;
  bodies.forEach((body, k) => {
    dv.setUint16(k * 2, at, true);
    out.set(body, at);
    at += body.length;
  });
  return out;
}

/** The `index: text` lines `rae msg` prints. */
export function formatMessages(texts: readonly string[]): string {
  return texts.map((text, k) => `${k}: ${text}`).join('\n') + '\n';
}

/**
 * Parse `index: text` lines. Blank lines are skipped. Indexes must run 0, 1, 2...
 * so a missing or repeated line is an error rather than a silent renumbering.
 * Exactly one space after the colon is the separator; any further space is text.
 */
export function parseMessages(source: string): string[] {
  const texts: string[] = [];
  source.split(/\r?\n/).forEach((line, n) => {
    if (line.trim() === '') return;
    const m = /^(\d+):(?: |$)(.*)$/.exec(line);
    if (!m) throw new MessageError(`line ${n + 1}: expected "index: text", got ${JSON.stringify(line)}`, n);
    if (Number(m[1]) !== texts.length) {
      throw new MessageError(`line ${n + 1}: expected index ${texts.length}, got ${m[1]}`, n);
    }
    texts.push(m[2]);
  });
  return texts;
}
