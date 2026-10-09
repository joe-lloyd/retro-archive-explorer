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

const OP_IF = 0x01;
const OP_ELSE = 0x02;
const OP_ENDIF = 0x03;
/** Opcodes that test a condition and so belong inside an `if (...)`. */
const CONDITIONS = new Set([0x04, 0x06, 0x07, 0x10, 0x11, 0x1a]);

export const ENEMY_NAMES: readonly string[] = [
  'Zombie (Groundskeeper)', 'Zombie (Naked)', 'Cerberus', 'Web Spinner', 'Black Tiger',
  'Crow', 'Hunter', 'Wasp', 'Plant 42', 'Chimera', 'Adder', 'Neptune', 'Tyrant 1',
  'Yawn 1', 'Plant42 (roots)', 'Fountain Plant', 'Tyrant 2', 'Zombie (Researcher)',
  'Yawn 2', 'Cobweb', 'Computer Hands (left)', 'Computer Hands (right)',
  '', '', '', '', '', '', '', '', '', '',
  'Chris (Stars)', 'Jill (Stars)', 'Barry (Stars)', 'Rebecca (Stars)', 'Wesker (Stars)',
  'Kenneth 1', 'Forrest', 'Richard', 'Enrico', 'Kenneth 2', 'Barry 2', 'Barry 2 (Stars)',
  'Rebecca 2 (Stars)', 'Barry 3', 'Wesker 2 (Stars)', 'Chris (Jacket)',
  'Jill (Black Shirt)', 'Chris 2 (Jacket)', 'Jill (Red Shirt)',
];

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

const FLAG_GROUPS = [
  'FG_SCENARIO', 'FG_COMMON', 'FG_LOCK', 'FG_ENEMY', 'FG_ROOM', 'FG_STATUS', 'FG_6',
  'FG_ITEM', 'FG_MAP', 'FG_9',
];
const SCE_NAMES = [
  'SCE_NONE', 'SCE_DOOR', 'SCE_MESSAGE', 'SCE_3', 'SCE_ITEM', 'SCE_5', 'SCE_6',
  'SCE_USEITEM', 'SCE_ITEMBOX', 'SCE_EVENT', 'SCE_SAVE', 'SCE_B', 'SCE_C', 'SCE_DOCUMENT',
  'SCE_HIKIDASHI', 'SCE_F', 'SCE_TYPEWRITER',
];
const WORK_NAMES = ['WK_PLAYER', 'WK_ENEMY', 'WK_OBJ', 'WK_AOT'];

const hex = (n: number, width = 2) => n.toString(16).toUpperCase().padStart(width, '0');

function tableName(table: readonly string[], prefix: string, value: number): string {
  const name = table[value];
  return name ? name : `${prefix}${hex(value)}`;
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
        args.push({ kind: 'name', value, name: tableName(SCE_NAMES, 'SCE_', value) });
        break;
      case 'r':
        args.push({ kind: 'name', value, name: roomName(value) });
        break;
      case 'f':
        args.push({ kind: 'name', value, name: tableName(FLAG_GROUPS, 'FG_', value) });
        break;
      case 'p':
        args.push({ kind: 'name', value, name: `event_${hex(value)}` });
        break;
      case 'w':
        args.push({ kind: 'name', value, name: tableName(WORK_NAMES, 'WK_', value) });
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
    const size = SIZES[opcode] ?? 0;
    if (size === 0 || at + size > end) break;
    const bytes = rdt.subarray(at, at + size);
    const entry = OPCODES[opcode] ?? '';
    const colon = entry.indexOf(':');
    const name = (colon < 0 ? entry : entry.slice(0, colon)) || `op_${hex(opcode)}`;
    const args =
      colon < 0
        ? Array.from(bytes.subarray(1), (value) => ({ kind: 'num' as const, value }))
        : decodeArgs(entry.slice(colon + 1), bytes, at);
    out.push({ offset: at, opcode, name, args, bytes });
    at += size;
  }
  return out;
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
 * `if` are joined with `&&`; `else` and `endif` open and close blocks.
 */
export function formatScd1(instructions: readonly ScdInstruction[]): string {
  const lines: string[] = [];
  let depth = 0;
  let pending: string[] | null = null;
  const emit = (text: string) => lines.push(`${'    '.repeat(Math.max(0, depth))}${text}`);
  const flushIf = () => {
    if (!pending) return;
    emit(`if (${pending.length ? pending.join(' && ') : 'true'}) {`);
    depth++;
    pending = null;
  };

  for (const ins of instructions) {
    if (pending && CONDITIONS.has(ins.opcode)) {
      pending.push(call(ins));
      continue;
    }
    flushIf();
    if (ins.opcode === OP_IF) {
      pending = [];
    } else if (ins.opcode === OP_ELSE) {
      depth--;
      emit('} else {');
      depth++;
    } else if (ins.opcode === OP_ENDIF) {
      depth--;
      emit('}');
    } else if (ins.opcode === 0x0e) {
      // nop
    } else if (ins.opcode === 0x00) {
      emit('return;');
    } else {
      emit(`${call(ins)};`);
    }
  }
  flushIf();
  while (depth > 0) {
    depth--;
    emit('}');
  }
  return lines.join('\n');
}
