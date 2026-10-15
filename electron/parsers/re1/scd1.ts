// RE1 room script (SCD) decoder.
//
// Opcode names, signatures, sizes and name tables are ported from
// biohazard-utils' Bio1ConstantTable / ScriptDecompiler (MIT, IntelOrca and
// contributors, https://github.com/biorand/biohazard-utils). Signature letters:
//   u  u8          U  u16         I  s16        l  u8 block length (label)
//   e  enemy type  t  item / key  s  SCE kind   r  target room
//   f  flag group  p  event id    w  work kind

const OPCODES: readonly string[] = [
  'end:u', 'if:l', 'else:l', 'endif:u', 'ck:fuu', 'set:fuu', 'cmpb:uuu', 'cmpw:uuuI',
  'setb:uuu', 'cutnext:u', 'cutcurr:u', 'message', 'door_aot_set:uIIIIuuuuurIIIItu',
  'aot_set:uIIIIsuuuuuuu', 'nop:u', 'scene_setup', 'testitem:t', 'testpickup:t',
  'aot_reset:usuIII', 'aot_delete:usu', 'evt_exec:uup', 'bgm_play:u', 'bgm_stop:u',
  'se_play_3d', 'item_aot_set:uIIIItuuuuuuuuuuuuuuu', 'setbyte:uuu', 'item_ck:t',
  'enemy:euuuuuuIuuIIIuuuu', 'timer_setup', 'ck_last_item', 'xa_on',
  'obj:uuuIIIIuuuuuuuuuuuuuuuu', 'dir_set:uIIIIII', 'pos_set:uIIIIII', 'ck_item_count',
  'cut_auto', 'aot_on:usu', 'aot_switch', '', 'snd_fadeout', 'eml_state', 'movie_on:u',
  'effect', 'plw_anim', 'remove_item:t', 'give_item:uuu', '', 'se_volume', 'inst_cfg',
  'setw', 'nop_wide', 'sys_multi', 'model_op', 'objtbl_b_set', 'ck_anim', 'tbl37_set',
  'ck_bits', 'get_eml_state', 'msgnode_set', 'eml_rot', 'ck_counter', 'effect_tracked',
  'effect_kill_a', 'ck_tween', 'obj_xfm', 'spd_set', 'effect_kill_b', 'se_rate',
  'task_kill', 'spd_add', 'msg_list', 'eml_pos', 'effect_clear', 'bank_bit',
  'bgm_bank_down', 'bgm_bank_up', 'swap_var', 'objs_hide', 'mass_mask', 'xa_flag',
  'xa_flag_ck',
];

// Total instruction size in bytes, opcode included. 0 means unknown: stop decoding.
const SIZES: readonly number[] = [
  2, 2, 2, 2, 4, 4, 4, 6, 4, 2, 2, 4, 26, 18, 2, 8,
  2, 2, 10, 4, 4, 2, 2, 10, 26, 4, 2, 22, 6, 2, 4, 28,
  14, 14, 4, 2, 4, 4, 0, 2, 6, 2, 12, 4, 2, 4, 0, 4,
  12, 4, 4, 2, 8, 4, 4, 4, 4, 2, 4, 6, 6, 12, 2, 6,
  16, 4, 4, 4, 2, 2, 44, 14, 2, 2, 2, 2, 4, 2, 4, 2,
  2,
];

export interface OpcodeInfo {
  opcode: number;
  name: string;
  /** Operand letters, or null when the operands are plain bytes. */
  signature: string | null;
  /** Instruction size in bytes, opcode included. */
  size: number;
}

/** Every opcode with a known size, indexed by opcode. */
const OPS: readonly (OpcodeInfo | undefined)[] = OPCODES.map((entry, opcode) => {
  const size = SIZES[opcode] ?? 0;
  if (size === 0) return undefined;
  const colon = entry.indexOf(':');
  const name = (colon < 0 ? entry : entry.slice(0, colon)) || `op_${hex(opcode)}`;
  return { opcode, name, signature: colon < 0 ? null : entry.slice(colon + 1), size };
});

export function opcodeByName(name: string): OpcodeInfo | undefined {
  return OPS.find((op) => op?.name === name);
}

/**
 * Size of the instruction at `at`. Three opcodes take a sub-command that sets
 * their length (docs/SCD_COMMAND_OPCODES.md in the Resident Evil PC decomp);
 * the rest have the fixed size from SIZES.
 */
function sizeAt(code: Uint8Array, at: number): number {
  const opcode = code[at];
  const size = SIZES[opcode] ?? 0;
  switch (opcode) {
    case 0x17: // se_play_3d: positions follow only for posType 0-3
      return (code[at + 4] ?? 0) > 3 ? 6 : 10;
    case 0x28: // enemy_prop_set
      switch (code[at + 3]) {
        case 1:
          return 8;
        case 6:
        case 8:
          return 4;
        default:
          return 6;
      }
    case 0x33: // player_prop_set
      return [1, 3, 5, 8, 9, 10].includes(code[at + 1]) ? 4 : 2;
    default:
      return size;
  }
}

const OP_IF = 0x01;
const OP_ELSE = 0x02;
const OP_ENDIF = 0x03;
/** Opcodes that test a condition and so belong inside an `if (...)`. */
const CONDITIONS = new Set([0x04, 0x06, 0x07, 0x10, 0x11, 0x1a]);

// Types 0x00 and 0x11 follow the decomp's EMD table (em1000 white coat, em1011
// green coat) and were confirmed in game by swapping one for the other; the
// biohazard-utils names (Groundskeeper, Researcher) had them backwards.
export const ENEMY_NAMES: readonly string[] = [
  'Zombie (White Coat)', 'Zombie (Naked)', 'Cerberus', 'Web Spinner', 'Black Tiger',
  'Crow', 'Hunter', 'Wasp', 'Plant 42', 'Chimera', 'Adder', 'Neptune', 'Tyrant 1',
  'Yawn 1', 'Plant42 (roots)', 'Fountain Plant', 'Tyrant 2', 'Zombie (Green Coat)',
  'Yawn 2', 'Cobweb', 'Computer Hands (left)', 'Computer Hands (right)',
  '', '', '', '', '', '', '', '', '', '',
  'Chris (Stars)', 'Jill (Stars)', 'Barry (Stars)', 'Rebecca (Stars)', 'Wesker (Stars)',
  'Kenneth 1', 'Forrest', 'Richard', 'Enrico', 'Kenneth 2', 'Barry 2', 'Barry 2 (Stars)',
  'Rebecca 2 (Stars)', 'Barry 3', 'Wesker 2 (Stars)', 'Chris (Jacket)',
  'Jill (Black Shirt)', 'Chris 2 (Jacket)', 'Jill (Red Shirt)',
];

/**
 * Enemy types the engine can load. LoadEntityEMD reads g_emdPathTable at
 * (type + 4), and that table holds 53 entries per player, so types 0-48 name a
 * model. ENEMY_NAMES lists a few more (Jill, Chris variants) that the engine
 * would read from the other player's half of the table.
 */
export const ENEMY_TYPE_COUNT = 53 - 4;

/**
 * Highest item id the engine has a name for: g_ItemNamePointers holds 128
 * entries and is indexed by item id - 1. Retail rooms place items up to 110
 * (the files and documents), well past the 76 ids ITEM_NAMES labels.
 */
export const MAX_ITEM_ID = 128;

export const ITEM_NAMES: readonly string[] = [
  'Nothing', 'Combat Knife', 'Beretta', 'Shotgun', 'DumDum Colt', 'Colt Python',
  'FlameThrower', 'Bazooka Acid', 'Bazooka Explosive', 'Bazooka Flame', 'Rocket Launcher',
  'Clip', 'Shells', 'DumDum Rounds', 'Magnum Rounds', 'FlameThrower Fuel',
  'Explosive Rounds', 'Acid Rounds', 'Flame Rounds', 'Empty Bottle', 'Water', 'Umb No. 2',
  'Umb No. 4', 'Umb No. 7', 'Umb No. 13', 'Yellow 6', 'NP-003', 'V-Jolt', 'Broken Shotgun',
  'Square Crank', 'Hex Crank', 'Wood Emblem', 'Gold Emblem', 'Blue Jewel', 'Red Jewel',
  'Music Notes', 'Wolf Medal', 'Eagle Medal', 'Chemical', 'Battery', 'MO Disk',
  'Wind Crest', 'Flare', 'Slides', 'Moon Crest', 'Star Crest', 'Sun Crest', 'Ink Ribbon',
  'Lighter', 'Lock Pick', 'Nameless (Can of Oil)', 'Sword Key', 'Armor Key', 'Shield Key',
  'Helmet Key', 'Lab Key (1)', 'Special Key', 'Dorm Key (002)', 'Dorm Key (003)',
  'C. Room Key', 'Lab Key (2)', 'Small Key', 'Red Book', 'Doom Book (2)', 'Doom Book (1)',
  'F-Aid Spray', 'Serum', 'Red Herb', 'Green Herb', 'Blue Herb', 'Mixed (Red+Green)',
  'Mixed (2 Green)', 'Mixed (Blue + Green)', 'Mixed (All)', 'Mixed (Silver Color)',
  'Mixed (Bright Blue-Green)',
];

export const FLAG_GROUPS = [
  'FG_SCENARIO', 'FG_COMMON', 'FG_LOCK', 'FG_ENEMY', 'FG_ROOM', 'FG_STATUS', 'FG_6',
  'FG_ITEM', 'FG_MAP', 'FG_9',
];
const SCE_NAMES = [
  'SCE_NONE', 'SCE_DOOR', 'SCE_MESSAGE', 'SCE_3', 'SCE_ITEM', 'SCE_5', 'SCE_6',
  'SCE_USEITEM', 'SCE_ITEMBOX', 'SCE_EVENT', 'SCE_SAVE', 'SCE_B', 'SCE_C', 'SCE_DOCUMENT',
  'SCE_HIKIDASHI', 'SCE_F', 'SCE_TYPEWRITER',
];
const WORK_NAMES = ['WK_PLAYER', 'WK_ENEMY', 'WK_OBJ', 'WK_AOT'];

function hex(n: number, width = 2): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

function tableName(table: readonly string[], prefix: string, value: number): string {
  const name = table[value];
  return name ? name : `${prefix}${hex(value)}`;
}

/** A named constant when `value` is in `table`, otherwise the plain number. */
function constArg(table: readonly string[], value: number): ScdArg {
  const name = table[value];
  return name ? { kind: 'name', value, name } : { kind: 'num', value };
}

/**
 * Room id byte as `ROOM_105`, matching the `ROOM1050.RDT` file stem. The top 3
 * bits are the stage number; 0 means "same stage as this room".
 */
export function roomName(target: number): string {
  const stage = target >> 5;
  return `ROOM_${stage === 0 ? 'S' : stage}${hex(target & 0x1f)}`;
}

export function enemyName(type: number): string {
  return tableName(ENEMY_NAMES, 'ENEMY_', type);
}

export function itemName(type: number): string {
  return tableName(ITEM_NAMES, 'ITEM_', type);
}

function keyName(value: number): string {
  if (value === 0) return 'UNLOCKED';
  if (value === 254) return 'UNLOCK';
  if (value === 255) return 'LOCKED';
  return itemName(value);
}

export type ScdArg =
  | { kind: 'num'; value: number }
  | { kind: 'name'; value: number; name: string }
  | { kind: 'label'; target: number };

export interface ScdInstruction {
  /** Byte offset in the RDT file. */
  offset: number;
  opcode: number;
  name: string;
  args: ScdArg[];
  bytes: Uint8Array;
}

function decodeArgs(signature: string, bytes: Uint8Array, offset: number): ScdArg[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const args: ScdArg[] = [];
  let at = 1;
  for (const c of signature) {
    if (c === 'U' || c === 'I') {
      if (at + 2 > bytes.length) break;
      const value = c === 'U' ? view.getUint16(at, true) : view.getInt16(at, true);
      args.push({ kind: 'num', value });
      at += 2;
      continue;
    }
    if (at >= bytes.length) break;
    const value = bytes[at++];
    switch (c) {
      case 'l':
        args.push({ kind: 'label', target: offset + value });
        break;
      case 'e':
        args.push({ kind: 'name', value, name: enemyName(value) });
        break;
      case 't':
        args.push({ kind: 'name', value, name: keyName(value) });
        break;
      case 's':
        args.push(constArg(SCE_NAMES, value));
        break;
      case 'r':
        args.push({ kind: 'name', value, name: roomName(value) });
        break;
      case 'f':
        args.push(constArg(FLAG_GROUPS, value));
        break;
      case 'p':
        args.push({ kind: 'name', value, name: `event_${hex(value)}` });
        break;
      case 'w':
        args.push(constArg(WORK_NAMES, value));
        break;
      default:
        args.push({ kind: 'num', value });
    }
  }
  return args;
}

/**
 * Decode one SCD procedure: a stream of opcodes starting at `start` and ending
 * at `end` (exclusive) within `rdt`. Stops at the first opcode of unknown size.
 */
export function readScd1(rdt: Uint8Array, start: number, end: number): ScdInstruction[] {
  const out: ScdInstruction[] = [];
  let at = start;
  while (at < end && at < rdt.length) {
    const opcode = rdt[at];
    const info = OPS[opcode];
    const size = sizeAt(rdt, at);
    if (!info || size === 0 || at + size > end) break;
    const bytes = rdt.subarray(at, at + size);
    const args =
      info.signature === null
        ? Array.from(bytes.subarray(1), (value) => ({ kind: 'num' as const, value }))
        : decodeArgs(info.signature, bytes, at);
    out.push({ offset: at, opcode, name: info.name, args, bytes });
    at += size;
  }
  return out;
}

const SIGNATURE_RANGES: Record<string, [number, number]> = { U: [0, 0xffff], I: [-0x8000, 0x7fff] };

/** Operand value as a number; a label is not allowed where a number is. */
function numericArg(arg: ScdArg, what: string): number {
  if (arg.kind === 'label') throw new Error(`${what}: expected a number, got a label`);
  return arg.value;
}

/** Encode one instruction. Labels are stored as the distance from `offset`. */
function encodeInstruction(ins: ScdInstruction): Uint8Array {
  const info = OPS[ins.opcode];
  if (!info) throw new Error(`opcode 0x${hex(ins.opcode)} has no known size`);
  // Opcodes without a signature take plain bytes, as many as the arguments given.
  const signature = info.signature ?? 'u'.repeat(ins.args.length);
  if (ins.args.length !== signature.length) {
    throw new Error(`${info.name} takes ${signature.length} operands, got ${ins.args.length}`);
  }
  const bytes: number[] = [ins.opcode];
  [...signature].forEach((letter, i) => {
    const arg = ins.args[i];
    const what = `${info.name} operand ${i + 1}`;
    const value = letter === 'l' ? labelDistance(arg, ins.offset, what) : numericArg(arg, what);
    const [min, max] = SIGNATURE_RANGES[letter] ?? [0, 0xff];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${what} is ${value}, outside ${min}..${max}`);
    }
    bytes.push(value & 0xff);
    if (letter === 'U' || letter === 'I') bytes.push((value >> 8) & 0xff);
  });
  const out = Uint8Array.from(bytes);
  if (sizeAt(out, 0) !== out.length) {
    throw new Error(`${info.name} with ${ins.args.length} operands is ${out.length} bytes, the decoder reads ${sizeAt(out, 0)}`);
  }
  return out;
}

function labelDistance(arg: ScdArg, offset: number, what: string): number {
  if (arg.kind !== 'label') throw new Error(`${what}: expected a label`);
  return arg.target - offset;
}

/**
 * The inverse of `readScd1`: encode instructions back to bytes. Only `opcode`,
 * `args` and `offset` are read, so instructions built or edited by hand work;
 * label targets and offsets must agree.
 */
export function encodeScd1(instructions: readonly ScdInstruction[]): Uint8Array {
  const parts = instructions.map(encodeInstruction);
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The value of a named constant that `formatScd1` prints bare for the operand
 * letter, such as FG_ITEM or ROOM_203. Undefined when `token` is not one.
 */
export function parseConstant(letter: string, token: string): number | undefined {
  const index = (table: readonly string[]) => {
    const i = table.indexOf(token);
    return i < 0 ? undefined : i;
  };
  const fallback = (prefix: string) => {
    const m = new RegExp(`^${prefix}([0-9A-F]{2})$`).exec(token);
    return m ? parseInt(m[1], 16) : undefined;
  };
  switch (letter) {
    case 'f':
      return index(FLAG_GROUPS);
    case 's':
      return index(SCE_NAMES);
    case 'w':
      return index(WORK_NAMES);
    case 'e':
      return fallback('ENEMY_');
    case 't':
      return new Map([['UNLOCKED', 0], ['UNLOCK', 254], ['LOCKED', 255]]).get(token) ?? fallback('ITEM_');
    case 'r': {
      const m = /^ROOM_(S|[1-7])([0-9A-F]{2})$/.exec(token);
      if (!m || parseInt(m[2], 16) > 0x1f) return undefined;
      return (m[1] === 'S' ? 0 : Number(m[1])) * 32 + parseInt(m[2], 16);
    }
    default:
      return undefined;
  }
}

function formatArg(arg: ScdArg): string {
  switch (arg.kind) {
    case 'num':
      return String(arg.value);
    case 'name':
      // Identifiers like FG_ITEM print bare; display names keep the raw value.
      return /^[A-Z0-9_]+$/.test(arg.name) ? arg.name : `${arg.value} /* ${arg.name} */`;
    case 'label':
      return `@${hex(arg.target, 5)}`;
    default: {
      const exhaustive: never = arg;
      return exhaustive;
    }
  }
}

function call(ins: ScdInstruction): string {
  return `${ins.name}(${ins.args.map(formatArg).join(', ')})`;
}

/**
 * Render decoded instructions as indented pseudo-C. Conditions that follow an
 * `if` are joined with `&&`. An `if` block closes at `endif`; an `else` block
 * has no `endif` and closes at the offset its length byte points to, as in the
 * reference decompiler.
 */
export function formatScd1(instructions: readonly ScdInstruction[]): string {
  const lines: string[] = [];
  // Open blocks, innermost last. An else block records where it ends.
  const blocks: ({ kind: 'if' } | { kind: 'else'; end: number })[] = [];
  let pending: string[] | null = null;
  const emit = (text: string) => lines.push(`${'    '.repeat(blocks.length)}${text}`);
  const close = () => {
    blocks.pop();
    emit('}');
  };
  const flushIf = () => {
    if (!pending) return;
    emit(`if (${pending.length ? pending.join(' && ') : 'true'}) {`);
    blocks.push({ kind: 'if' });
    pending = null;
  };

  for (const ins of instructions) {
    if (pending && CONDITIONS.has(ins.opcode)) {
      pending.push(call(ins));
      continue;
    }
    flushIf();
    for (let top = blocks.at(-1); top?.kind === 'else' && top.end <= ins.offset; top = blocks.at(-1)) close();

    const label = ins.args[0];
    if (ins.opcode === OP_IF) {
      pending = [];
    } else if (ins.opcode === OP_ELSE && label?.kind === 'label') {
      if (blocks.length) blocks.pop();
      emit('} else {');
      blocks.push({ kind: 'else', end: label.target });
    } else if (ins.opcode === OP_ENDIF) {
      if (blocks.length) close();
    } else if (ins.opcode === 0x00 && ins.bytes[1] === 0) {
      emit('return;');
    } else {
      emit(`${call(ins)};`);
    }
  }
  flushIf();
  while (blocks.length) close();
  return lines.join('\n');
}
