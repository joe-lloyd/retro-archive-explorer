// RE1 event script (EVT) decoder and formatter. The format, with the engine
// functions every opcode comes from, is in docs/EVT_FORMAT.md.
//
// An event script is read by room_events_check, a small VM with three states.
// The state picks the table a byte is read from, so the same byte means one
// thing after anim_begin() and another after move_begin(). The decoder walks
// each script from its entry point in the command state, as ScdEventEntry_Init
// starts it, and follows every state change on the way.
import { formatScd1, formatScdCall, readScd1, scdIsCanonical, type ScdInstruction } from './scd1';

/** ScdEventEntry.state: 0 command, 1 animation, 2 movement. */
export type EvtState = 'command' | 'anim' | 'move';

/**
 * Operand letters:
 *   u  u8           b  s8            U  u16         I  s16
 *   p  event index  k  entity kind   0  a byte the engine skips, always 0, not shown
 */
export interface EvtOp {
  name: string;
  /** The state the op is read in. Control ops are read the same way in every state. */
  state: EvtState | 'any';
  /** The bytes that select the op. */
  code: readonly number[];
  signature: string;
  /** The state after the op. */
  next: EvtState | 'same';
}

const op = (state: EvtOp['state'], code: number[], name: string, signature = '', next: EvtOp['next'] = 'same'): EvtOp => ({
  name, state, code, signature, next,
});

/**
 * Every op with a fixed layout. Blocks and keywords (return, repeat, do/while,
 * scd blocks and single SCD commands) are decoded on their own below.
 * anim_look_at has two layouts: the long one when the flags' low nibble is set.
 */
export const EVT_OPS: readonly EvtOp[] = [
  op('any', [0xf6, 0xf7], 'wait_voice'),
  op('any', [0xf8, 0xf9], 'sleep', 'U'),
  op('any', [0xfe], 'yield'),
  op('command', [0x00], 'evt_nop'),
  op('command', [0x01], 'anim_begin', '', 'anim'),
  op('command', [0x02], 'move_begin_reset', '', 'move'),
  op('command', [0x03], 'move_begin', '', 'move'),
  op('command', [0x04], 'set_entity', 'ku'),
  op('command', [0x05], 'evt_start', 'up0'),
  op('command', [0x08], 'evt_jump', 'p'),
  op('command', [0x09], 'evt_kill', 'u'),
  op('anim', [0x00], 'anim_nop'),
  op('anim', [0x80], 'anim_end_release', '', 'command'),
  op('anim', [0x81], 'anim_look_at', 'u'),
  op('anim', [0x81], 'anim_look_at', 'uIIIuu'),
  op('anim', [0x82], 'anim_look_off'),
  op('anim', [0x83], 'anim_pose', 'uUUu'),
  op('anim', [0x84], 'anim_play', 'uuu'),
  op('anim', [0x85], 'anim_action', 'uuu'),
  op('anim', [0x86], 'anim_idle'),
  op('anim', [0x87], 'anim_flags', 'uU'),
  op('anim', [0x88], 'anim_timer', '0U'),
  op('anim', [0x89], 'anim_frame', 'u'),
  op('anim', [0x8a], 'anim_frame_raw', 'u'),
  op('anim', [0x8b], 'anim_end', '', 'command'),
  op('move', [0x00], 'move_nop'),
  op('move', [0x01], 'move_end', '', 'command'),
  op('move', [0x02], 'move_step'),
  op('move', [0x03], 'move_turn'),
  op('move', [0x04], 'move_step_turn'),
  op('move', [0x05], 'move_speed', 'bbb'),
  op('move', [0x06], 'move_turn_speed', 'bbb'),
  op('move', [0x07], 'move_pos', '0III'),
  op('move', [0x08], 'move_byte', 'uu'),
  op('move', [0x09], 'move_hit_state', 'u'),
  op('move', [0x0a], 'move_field', 'uI'),
  op('move', [0x0b], 'move_rot', '0III'),
];

export const EVT = {
  SCD_BLOCK: 0x06,
  SCD_COMMAND: 0x07,
  REPEAT: 0xfa,
  REPEAT_END: 0xfb,
  DO: 0xfc,
  WHILE: 0xfd,
  RETURN: 0xff,
} as const;

/** set_entity's first operand (scd_event_cmd_set_entity). */
export const ENTITY_KINDS = ['ENT_PLAYER', 'ENT_ENEMY', 'ENT_OBJECT', 'ENT_ITEM'] as const;

/** Size of an op in bytes: its code plus its operands. */
export function evtOpSize(info: EvtOp): number {
  return info.code.length + [...info.signature].reduce((n, c) => n + (c === 'U' || c === 'I' ? 2 : 1), 0);
}

/** anim_look_at reads 8 more bytes when the low nibble of its flags is set. */
export const lookAtIsLong = (flags: number) => (flags & 0x0f) !== 0;

interface Located {
  /** Byte offset in the RDT file. */
  offset: number;
  size: number;
  /** The state the instruction is read in. */
  state: EvtState;
}

export type EvtInstruction = Located &
  (
    | { kind: 'op'; op: EvtOp; args: number[] }
    | { kind: 'return' }
    | { kind: 'repeat'; count: number }
    | { kind: 'repeat_end' }
    /** The loop condition is stored at the head and tested at the tail. */
    | { kind: 'do'; condition: ScdInstruction }
    | { kind: 'while' }
    | { kind: 'scd'; command: ScdInstruction }
    /**
     * A single SCD command whose length byte does not match the command. The
     * engine runs the whole command from the payload on, past the payload when
     * it is short (`runs`, null when it does not decode), then goes on at the
     * length.
     */
    | { kind: 'scd_bytes'; bytes: Uint8Array; runs: ScdInstruction | null }
    | { kind: 'scd_block'; instructions: ScdInstruction[] }
    /** An SCD block whose if and else lengths the scd { } text cannot keep; `bytes` is the code. */
    | { kind: 'scd_block_bytes'; instructions: ScdInstruction[]; bytes: Uint8Array }
    /** Bytes from the first one the engine cannot run to the end of the script. */
    | { kind: 'raw'; bytes: Uint8Array }
  );

interface Decoded {
  ins: EvtInstruction;
  next: EvtState;
}
type Open = { kind: 'repeat' | 'do'; state: EvtState; index: number };

const isNop = (ins: EvtInstruction) => ins.kind === 'op' && ins.op.code.length === 1 && ins.op.code[0] === 0 && ins.size === 1;

function readOperands(bytes: Uint8Array, at: number, signature: string): number[] | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const args: number[] = [];
  for (const c of signature) {
    if (c === 'U' || c === 'I') {
      args.push(c === 'U' ? dv.getUint16(at, true) : dv.getInt16(at, true));
      at += 2;
    } else if (c === '0') {
      if (bytes[at++] !== 0) return null;
    } else {
      args.push(c === 'b' ? dv.getInt8(at) : bytes[at]);
      at += 1;
    }
  }
  return args;
}

/** One SCD instruction filling `start..end` exactly, or null. Blocks cannot stand alone. */
function oneScdCommand(bytes: Uint8Array, start: number, end: number): ScdInstruction | null {
  const [ins, ...rest] = readScd1(bytes, start, end);
  if (!ins || rest.length || ins.offset + ins.bytes.length !== end || [0x01, 0x02, 0x03].includes(ins.opcode)) return null;
  return ins;
}

/** Decode the instruction at `at`, or null when the engine would stop or hang there. */
function decodeOne(bytes: Uint8Array, at: number, end: number, state: EvtState): Decoded | null {
  const b = bytes[at];
  const fits = (size: number) => size >= 1 && at + size <= end;
  const base = { offset: at, state };
  const same = (ins: EvtInstruction): Decoded => ({ ins, next: state });
  switch (b) {
    case EVT.RETURN:
      return same({ ...base, kind: 'return', size: 1 });
    case EVT.REPEAT:
      return fits(4) && bytes[at + 1] === 0
        ? same({ ...base, kind: 'repeat', size: 4, count: bytes[at + 2] | (bytes[at + 3] << 8) })
        : null;
    case EVT.REPEAT_END:
      return same({ ...base, kind: 'repeat_end', size: 1 });
    case EVT.DO: {
      const size = bytes[at + 1];
      const condition = fits(size) && size > 2 ? oneScdCommand(bytes, at + 2, at + size) : null;
      return condition ? same({ ...base, kind: 'do', size, condition }) : null;
    }
    case EVT.WHILE:
      return same({ ...base, kind: 'while', size: 1 });
  }
  if (state === 'command' && b === EVT.SCD_COMMAND) {
    const size = bytes[at + 1];
    if (!fits(size) || size < 3) return null;
    const command = oneScdCommand(bytes, at + 2, at + size);
    if (command) return same({ ...base, kind: 'scd', size, command });
    const runs = readScd1(bytes, at + 2, bytes.length)[0] ?? null;
    return same({ ...base, kind: 'scd_bytes', size, bytes: bytes.subarray(at + 2, at + size), runs });
  }
  if (state === 'command' && b === EVT.SCD_BLOCK) {
    // 06 LL [u16 size][body]: run_command_functions reads the next block size
    // right after the body, from the low byte at LL - 1 and the high byte at
    // LL, which is the next event byte. Both must be 0, so the block owns the
    // zero that follows it.
    const size = bytes[at + 1];
    const block = at + 2 < end ? bytes[at + 2] | (bytes[at + 3] << 8) : 0;
    if (!fits(size + 1) || block < 2 || size !== block + 3 || bytes[at + size - 1] !== 0 || bytes[at + size] !== 0) return null;
    const instructions = readScd1(bytes, at + 4, at + 2 + block);
    const read = instructions.reduce((n, ins) => n + ins.bytes.length, 0);
    if (read !== block - 2) return null;
    if (scdIsCanonical(instructions, at + 2 + block)) return same({ ...base, kind: 'scd_block', size: size + 1, instructions });
    return same({ ...base, kind: 'scd_block_bytes', size: size + 1, instructions, bytes: bytes.subarray(at + 4, at + 2 + block) });
  }
  for (const info of EVT_OPS) {
    if (info.state !== 'any' && info.state !== state) continue;
    if (!info.code.every((c, i) => bytes[at + i] === c)) continue;
    if (info.name === 'anim_look_at' && lookAtIsLong(bytes[at + 1]) !== (info.signature.length > 1)) continue;
    const size = evtOpSize(info);
    const args = fits(size) ? readOperands(bytes, at + info.code.length, info.signature) : null;
    if (!args) return null;
    return { ins: { ...base, kind: 'op', op: info, args, size }, next: info.next === 'same' ? state : info.next };
  }
  return null;
}

/**
 * Decode one event script stored at `start..end` in `rdt`. Up to three
 * trailing zero bytes that pad the script to a 4-byte boundary are left out.
 * When a byte would stop or hang the engine, the rest of the script is kept as
 * one `raw` instruction, starting at the outermost loop still open.
 */
export function readEvt1(rdt: Uint8Array, start: number, end: number): EvtInstruction[] {
  const out: EvtInstruction[] = [];
  const open: Open[] = [];
  let state: EvtState = 'command';
  let at = start;
  let stuck = false;
  while (at < end) {
    const d = decodeOne(rdt, at, end, state);
    const ins = d?.ins;
    // A loop tail must close a loop of its own kind that began in the same state.
    const closes = ins?.kind === 'repeat_end' ? 'repeat' : ins?.kind === 'while' ? 'do' : null;
    if (!d || !ins || (closes && (open.at(-1)?.kind !== closes || open.at(-1)?.state !== state))) {
      stuck = true;
      break;
    }
    if (closes) open.pop();
    if (ins.kind === 'repeat' || ins.kind === 'do') open.push({ kind: ins.kind, state, index: out.length });
    out.push(ins);
    state = d.next;
    at += ins.size;
  }
  if (stuck || open.length) {
    const from = open.length ? out[open[0].index].offset : at;
    out.splice(open.length ? open[0].index : out.length);
    out.push({ kind: 'raw', offset: from, size: end - from, state: open[0]?.state ?? state, bytes: rdt.subarray(from, end) });
  }
  return stripPadding(out, (end - start) % 4 === 0);
}

function stripPadding(out: EvtInstruction[], aligned: boolean): EvtInstruction[] {
  if (!aligned) return out;
  let left = 3;
  while (left > 0 && out.length && isNop(out[out.length - 1])) {
    out.pop();
    left--;
  }
  const last = out.at(-1);
  if (last?.kind === 'raw') {
    let size = last.bytes.length;
    while (left > 0 && size > 1 && last.bytes[size - 1] === 0) {
      size--;
      left--;
    }
    out[out.length - 1] = { ...last, size, bytes: last.bytes.subarray(0, size) };
  }
  return out;
}

/** Bytes the instructions take, padding not included. */
export const evtLength = (instructions: readonly EvtInstruction[]) => instructions.reduce((n, ins) => n + ins.size, 0);

/** Every SCD instruction an event script runs: single commands, loop conditions and scd blocks. */
export function evtScdInstructions(instructions: readonly EvtInstruction[]): ScdInstruction[] {
  return instructions.flatMap((ins) =>
    ins.kind === 'scd'
      ? [ins.command]
      : ins.kind === 'scd_bytes'
        ? (ins.runs ? [ins.runs] : [])
        : ins.kind === 'do'
          ? [ins.condition]
          : ins.kind === 'scd_block' || ins.kind === 'scd_block_bytes'
            ? ins.instructions
            : [],
  );
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const byteList = (bytes: Uint8Array) => Array.from(bytes, (b) => `0x${hex(b)}`).join(', ');

function formatOperand(letter: string, value: number): string {
  if (letter === 'p') return `${value} /* event_${hex(value)} */`;
  if (letter === 'k') return ENTITY_KINDS[value] ?? String(value);
  return String(value);
}

function formatOp(info: EvtOp, args: readonly number[]): string {
  const letters = [...info.signature].filter((c) => c !== '0');
  return `${info.name}(${args.map((v, i) => formatOperand(letters[i], v)).join(', ')});`;
}

/**
 * Render an event script as pseudo-C. Loops are blocks; statements between
 * anim_begin() and anim_end(), or move_begin() and move_end(), are indented
 * one more level, since the engine reads them from another table.
 */
export function formatEvt1(instructions: readonly EvtInstruction[]): string {
  const lines: string[] = [];
  const conditions: ScdInstruction[] = [];
  let depth = 0;
  instructions.forEach((ins, i) => {
    const after = instructions[i + 1]?.state ?? (ins.kind === 'op' && ins.op.next !== 'same' ? ins.op.next : ins.state);
    const inner = ins.state !== 'command' && after !== 'command' ? 1 : 0;
    const emit = (text: string) => lines.push(`${'    '.repeat(depth + inner)}${text}`);
    switch (ins.kind) {
      case 'op':
        emit(formatOp(ins.op, ins.args));
        break;
      case 'return':
        emit('return;');
        break;
      case 'repeat':
        emit(`repeat (${ins.count}) {`);
        depth++;
        break;
      case 'do':
        emit('do {');
        conditions.push(ins.condition);
        depth++;
        break;
      case 'repeat_end':
        depth--;
        emit('}');
        break;
      case 'while': {
        depth--;
        const condition = conditions.pop();
        emit(`} while (${condition ? formatScdCall(condition) : 'true'});`);
        break;
      }
      case 'scd':
        emit(`${formatScdCall(ins.command)};`);
        break;
      case 'scd_block':
        emit('scd {');
        for (const line of formatScd1(ins.instructions).split('\n')) if (line) emit(`    ${line}`);
        emit('}');
        break;
      case 'scd_bytes': {
        const past = ins.runs ? ins.runs.bytes.length - ins.bytes.length : 0;
        const note = !ins.runs
          ? 'not an SCD command'
          : past > 0
            ? `runs ${formatScdCall(ins.runs)}, reading ${past} bytes past its end`
            : `runs ${formatScdCall(ins.runs)} and skips ${-past} bytes`;
        emit(`scd_bytes(${byteList(ins.bytes)}); /* ${note} */`);
        break;
      }
      case 'scd_block_bytes':
        emit(`scd_block_bytes(${byteList(ins.bytes)}); /* an SCD block whose if lengths do not match its blocks */`);
        break;
      case 'raw':
        emit(`raw(${byteList(ins.bytes)});`);
        break;
      default: {
        const exhaustive: never = ins;
        return exhaustive;
      }
    }
  });
  return lines.join('\n');
}
