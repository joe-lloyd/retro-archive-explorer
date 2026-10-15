// RE1 room script assembler: the inverse of `formatScd1` and `formatEvt1`.
//
// Input is the pseudo-C that `pnpm rae script` prints. Each procedure starts
// with a `// init procedure N`, `// main procedure N` or `// event procedure N`
// header (anything after that, such as `@ 0x11e`, is ignored). Event
// procedures are a different bytecode; see assembleEvent and
// docs/EVT_FORMAT.md. Block lengths are recomputed from the content, so lines
// can be added or removed. Comments and the `/* Beretta */`
// notes after operands are dropped. A `/* ... */` comment may span lines, and
// a header inside one is part of the comment.
//
// A header that is spelled wrong (`// MAIN procedure 1`, `// main procdure 1`)
// is an error, and the numbers must run 0, 1, 2 within each section.
//
// The engine runs each procedure until an `end` instruction (`return;`, or
// `end(n)` with any n, since cmd_block_end never reads its operand). An `end`
// inside an if or else block only ends the procedure when that branch runs, so
// the procedure's last statement outside every block must be the `end`.
// Every init and main procedure except the last of its section must therefore end with
// `return;` and the assembler refuses it otherwise; it does not add one. The last
// procedure may omit it because the section's closing zero word is an `end`.
// Operands are checked against what the engine accepts: enemy and item types
// must be in its tables, `set` modes are 0 (set), 1 (clear) or 2 (toggle), and
// `if` blocks nest at most 16 deep, the size of its branch stack.
import { COUNT_MAX, ENTITY_KINDS, EVT, EVT_OPS, lookAtIsLong, type EvtOp, type EvtState } from './evt1';
import {
  encodeScd1, ENEMY_TYPE_COUNT, MAX_ITEM_ID, opcodeByName, parseConstant, type OpcodeInfo, type ScdArg, type ScdInstruction,
} from './scd1';

const SCRIPT_KINDS = ['init', 'main', 'event'] as const;
export type ScriptKind = (typeof SCRIPT_KINDS)[number];

/** Procedure bodies (opcodes only, no size prefix), in source order. */
export type AssembledScripts = Record<ScriptKind, Uint8Array[]>;

interface SourceLine {
  no: number;
  text: string;
}

type LabelArg = Extract<ScdArg, { kind: 'label' }>;

/** An open `if` or `else` block. Its label is filled in when the block closes. */
interface Block {
  kind: 'if' | 'else';
  label: LabelArg;
  line: number;
}

/** g_ScdBranchStack in the engine holds one resume address per open `if`. */
const MAX_NESTING = 16;
/** `set` operand 3: 0 sets the bit, 1 clears it, 2 toggles it (cmd_bit_op). */
const SET_MODES = 3;
/** Lock values the item operand also takes: UNLOCK and LOCKED. */
const LOCK_VALUES = [254, 255];

interface Procedure {
  bytes: Uint8Array;
  /** Line of its last statement. */
  lastLine: number;
  endsWithReturn: boolean;
}

/** A well-formed header. Anything after the number, such as `@ 0x11e`, is ignored. */
const HEADER = /^\/\/\s*(init|main|event)\s+procedure\s+(0|[1-9]\d*)(?:\s.*)?$/;
/** A comment that was meant as a header, so a misspelling is an error and not a silent comment. */
const HEADER_LIKE = /^\/\/\s*(init|main|event)\s+proc/i;
const HEADERS = '"// init procedure N", "// main procedure N" or "// event procedure N"';
const NUMBER = /^(-?)(\d+|0x[0-9a-f]+)$/i;

function fail(line: number, message: string): never {
  throw new Error(`line ${line}: ${message}`);
}

/**
 * The part of a line outside block comments, given whether a block comment is
 * open where the line starts. `inComment` says whether one is still open at its
 * end and `opened` whether this line opened it. A `//` outside a block comment
 * keeps the rest of the line as a line comment, a `/*` in it included.
 */
function outsideBlockComments(line: string, inComment: boolean): { text: string; inComment: boolean; opened: boolean } {
  let text = '';
  let opened = false;
  let i = 0;
  while (i < line.length) {
    if (inComment) {
      const close = line.indexOf('*/', i);
      if (close < 0) return { text, inComment, opened };
      inComment = false;
      opened = false;
      i = close + 2;
    } else if (line.startsWith('//', i)) {
      return { text: text + line.slice(i), inComment, opened };
    } else if (line.startsWith('/*', i)) {
      inComment = true;
      opened = true;
      i += 2;
    } else {
      text += line[i];
      i += 1;
    }
  }
  return { text, inComment, opened };
}

export function assembleScd1(text: string): AssembledScripts {
  const procedures: Record<ScriptKind, SourceLine[][]> = { init: [], main: [], event: [] };
  let current: SourceLine[] | undefined;
  let inComment = false;
  let commentLine = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    const visible = outsideBlockComments(raw, inComment);
    inComment = visible.inComment;
    if (visible.opened) commentLine = no;
    const trimmed = visible.text.trim();
    const header = HEADER.exec(trimmed);
    const kind = SCRIPT_KINDS.find((k) => k === header?.[1]);
    if (header && kind) {
      const number = Number(header[2]);
      const expected = procedures[kind].length;
      if (number < expected) fail(no, `${kind} procedure ${number} appears twice`);
      if (number > expected) fail(no, `${kind} procedure ${number} is out of order, expected ${kind} procedure ${expected}`);
      current = [];
      procedures[kind].push(current);
      return;
    }
    if (HEADER_LIKE.test(trimmed)) {
      fail(no, `"${trimmed}" looks like a procedure header but is not ${HEADERS} in lower case`);
    }
    const code = trimmed.replace(/\/\/.*$/, '').trim();
    if (!code) return;
    if (!current) fail(no, `code before the first ${HEADERS} header`);
    current.push({ no, text: code });
  });
  if (inComment) fail(commentLine, 'block comment "/*" is never closed by "*/"');
  const assemble = (kind: 'init' | 'main'): Uint8Array[] =>
    procedures[kind].map(assembleProcedure).map((p, i, all) => {
      if (i < all.length - 1 && !p.endsWithReturn) {
        fail(p.lastLine, `${kind} procedure ${i} must end with "return;"; only the last ${kind} procedure may leave it out`);
      }
      return p.bytes;
    });
  if (procedures.event.length > MAX_EVENTS) {
    fail(procedures.event[MAX_EVENTS][0]?.no ?? 0, `a room holds at most ${MAX_EVENTS} event procedures; scripts start them by a one-byte index`);
  }
  const event = procedures.event.map((lines, i) => {
    const bytes = assembleEvent(lines);
    if (bytes.length === 0) throw new Error(`event procedure ${i} is empty; give it at least "return;"`);
    return bytes;
  });
  return { init: assemble('init'), main: assemble('main'), event };
}

/** Parse `name(arg, arg, ...)` into an SCD opcode and operands, checked against what the engine accepts. */
function parseScdCall(call: string, line: number): { info: OpcodeInfo; args: ScdArg[] } {
  const match = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(call);
  if (!match) fail(line, `expected name(operands), got: ${call}`);
  const [, name, rest] = match;
  const info = opcodeByName(name);
  if (!info) fail(line, `unknown instruction ${name}`);
  if (name === 'if' || name === 'else' || name === 'endif') {
    fail(line, `${name} is written as a block: if (...) { ... } else { ... }`);
  }
  const tokens = rest.trim() === '' ? [] : rest.split(',').map((t) => t.trim());
  const args = tokens.map((token, i): ScdArg => {
    const number = NUMBER.exec(token);
    if (number) return { kind: 'num', value: number[1] ? -Number(number[2]) : Number(number[2]) };
    const value = parseConstant(info.signature?.[i] ?? 'u', token);
    if (value === undefined) fail(line, `${name} operand ${i + 1}: unknown value ${token}`);
    return { kind: 'num', value };
  });
  [...(info.signature ?? '')].forEach((letter, i) => {
    const arg = args[i];
    const value = arg?.kind === 'num' ? arg.value : undefined;
    if (value === undefined) return;
    const what = `${name} operand ${i + 1}`;
    if (letter === 'e' && value >= ENEMY_TYPE_COUNT) {
      fail(line, `${what} is enemy type ${value}, the engine has types 0-${ENEMY_TYPE_COUNT - 1}`);
    }
    if (letter === 't' && value > MAX_ITEM_ID && !LOCK_VALUES.includes(value)) {
      fail(line, `${what} is item ${value}, the engine has items 0-${MAX_ITEM_ID}`);
    }
    if (name === 'set' && i === 2 && value >= SET_MODES) {
      fail(line, `set mode is ${value}: 0 sets the flag, 1 clears it, 2 toggles it`);
    }
  });
  return { info, args };
}

/** One SCD command on its own, as an event script embeds it. */
function encodeScdCall(call: string, line: number): Uint8Array {
  const { info, args } = parseScdCall(call, line);
  try {
    return encodeScd1([{ offset: 0, opcode: info.opcode, name: info.name, args, bytes: new Uint8Array(0) }]);
  } catch (err) {
    fail(line, err instanceof Error ? err.message : String(err));
  }
}

/** Scripts start an event by a one-byte index (evt_exec, evt_start, evt_jump). */
const MAX_EVENTS = 256;
/** g_ScdEventTable runs 8 event scripts at once. */
const EVT_SLOTS = 8;
/** ScdEventEntry's return, call and counter stacks hold 4 entries each. */
const EVT_STACK = 4;
/** Length bytes (06, 07, FC) count the whole instruction in one byte. */
const MAX_LENGTH = 0xff;

const STATE_ENTRY: Record<EvtState, string> = {
  command: 'the command state',
  anim: 'the anim state, between anim_begin() and anim_end()',
  move: 'the move state, between move_begin() and move_end()',
};
const STATE_EXIT: Record<EvtState, string> = { command: '', anim: 'anim_end()', move: 'move_end()' };

function parseNumber(token: string, line: number, what: string, min: number, max: number): number {
  const m = NUMBER.exec(token);
  const value = m ? (m[1] ? -Number(m[2]) : Number(m[2])) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) fail(line, `${what} is ${token}, expected ${min}..${max}`);
  return value;
}

const OPERAND_RANGES: Record<string, [number, number]> = {
  u: [0, 0xff], p: [0, MAX_EVENTS - 1], k: [0, 0xff], b: [-0x80, 0x7f], U: [0, 0xffff], I: [-0x8000, 0x7fff],
};

/** Operand bytes for an event op; `0` letters are skipped bytes written as 0. */
function encodeEvtOperands(info: EvtOp, tokens: readonly string[], line: number): number[] {
  const out: number[] = [];
  let k = 0;
  for (const letter of info.signature) {
    if (letter === '0') {
      out.push(0);
      continue;
    }
    const token = tokens[k++];
    const what = `${info.name} operand ${k}`;
    const named = letter === 'k' ? ENTITY_KINDS.findIndex((n) => n === token) : -1;
    // The engine counts down before it tests for 0, so 65536 is stored as 0 and 0 cannot be written.
    const [min, max] = info.name === 'sleep' ? [1, COUNT_MAX] : OPERAND_RANGES[letter];
    const value = named >= 0 ? named : parseNumber(token, line, what, min, max);
    out.push(value & 0xff);
    if (letter === 'U' || letter === 'I') out.push((value >> 8) & 0xff);
  }
  return out;
}

/**
 * 06 LL [u16 size][code], then the zero word that ends run_command_functions.
 * Its high byte is the next event byte, an evt_nop the block owns.
 */
function scdBlock(code: ArrayLike<number>, line: number): number[] {
  const block = code.length + 2;
  if (block + 3 > MAX_LENGTH) fail(line, `scd block is ${code.length} bytes, the limit is ${MAX_LENGTH - 5}`);
  return [EVT.SCD_BLOCK, block + 3, block & 0xff, block >> 8, ...Array.from(code), 0, 0];
}

/** An open repeat or do block. */
interface EvtLoop {
  kind: 'repeat' | 'do';
  state: EvtState;
  line: number;
  /** Where its head starts in the output. */
  at: number;
  /** A yield, sleep or wait_voice ran inside it. */
  yields: boolean;
}

/**
 * Assemble one event procedure. The engine reads each byte from the table of
 * the state it is in, so the assembler tracks the state as room_events_check
 * does and refuses an op the current state would not read: the engine would
 * deactivate the event (command state) or spin on the byte forever (anim and
 * move states).
 */
function assembleEvent(lines: SourceLine[]): Uint8Array {
  const out: number[] = [];
  const loops: EvtLoop[] = [];
  let state: EvtState = 'command';
  let rawLine = 0;

  const needCommand = (what: string, line: number) => {
    if (state !== 'command') fail(line, `${what} runs only in the command state; end the ${state} state with ${STATE_EXIT[state]} first`);
  };
  const openLoop = (kind: EvtLoop['kind'], line: number) => {
    if (loops.length >= EVT_STACK) fail(line, `repeat and do blocks nest at most ${EVT_STACK} deep, the size of the event's stacks`);
    loops.push({ kind, state, line, at: out.length, yields: false });
  };
  const closeLoop = (kind: EvtLoop['kind'], line: number): EvtLoop => {
    const top = loops.pop();
    if (!top) fail(line, 'unmatched "}"');
    if (top.kind !== kind) fail(line, top.kind === 'do' ? 'a do block closes with "} while (...);"' : 'a repeat block closes with "}"');
    if (top.state !== state) {
      fail(line, `this ${kind} block began in the ${top.state} state and ends in the ${state} state; the engine would read its second pass from the wrong table`);
    }
    if (kind === 'do' && !top.yields) {
      fail(top.line, 'a do block must yield(), sleep() or wait_voice() inside, or the engine tests its condition again in the same frame for as long as it holds');
    }
    return top;
  };

  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i];
    if (rawLine) fail(no, `raw(...) on line ${rawLine} must be the last statement of its event procedure`);
    let m: RegExpExecArray | null;
    if (text === 'return;') {
      out.push(EVT.RETURN);
    } else if ((m = /^repeat\s*\((.*)\)\s*\{$/.exec(text))) {
      const count = parseNumber(m[1].trim(), no, 'repeat count', 1, COUNT_MAX) & 0xffff;
      openLoop('repeat', no);
      out.push(EVT.REPEAT, 0, count & 0xff, count >> 8);
    } else if (/^do\s*\{$/.test(text)) {
      openLoop('do', no);
      out.push(EVT.DO, 0);
    } else if ((m = /^\}\s*while\s*\((.*)\)\s*;$/.exec(text))) {
      const top = closeLoop('do', no);
      const condition = encodeScdCall(m[1].trim(), no);
      out.splice(top.at + 2, 0, ...condition);
      out[top.at + 1] = condition.length + 2;
      out.push(EVT.WHILE);
    } else if (text === '}') {
      closeLoop('repeat', no);
      out.push(EVT.REPEAT_END);
    } else if (/^scd\s*\{$/.test(text)) {
      needCommand('an scd block', no);
      const body: SourceLine[] = [];
      let depth = 1;
      for (i++; i < lines.length; i++) {
        const t = lines[i].text;
        if (t.startsWith('}')) depth--;
        if (depth === 0) break;
        if (t.endsWith('{')) depth++;
        body.push(lines[i]);
      }
      if (depth !== 0) fail(no, 'scd block is never closed');
      if (lines[i].text !== '}') fail(lines[i].no, `an scd block closes with "}", got: ${lines[i].text}`);
      out.push(...scdBlock(assembleProcedure(body).bytes, no));
    } else if (/^if\b/.test(text)) {
      fail(no, 'an if block runs as SCD: put it inside scd { ... }');
    } else if ((m = /^([A-Za-z_]\w*)\s*\((.*)\)\s*;$/.exec(text))) {
      const [, name, rest] = m;
      const tokens = rest.trim() === '' ? [] : rest.split(',').map((t) => t.trim());
      const candidates = EVT_OPS.filter((o) => o.name === name);
      if (name === 'raw' || name === 'scd_bytes' || name === 'scd_block_bytes') {
        if (!tokens.length) fail(no, `${name} takes at least one byte`);
        const bytes = tokens.map((t, k) => parseNumber(t, no, `${name} byte ${k + 1}`, 0, 0xff));
        if (name === 'raw') {
          out.push(...bytes);
          rawLine = no;
        } else if (name === 'scd_bytes') {
          needCommand(name, no);
          if (bytes.length + 2 > MAX_LENGTH) fail(no, `scd_bytes takes at most ${MAX_LENGTH - 2} bytes`);
          out.push(EVT.SCD_COMMAND, bytes.length + 2, ...bytes);
        } else {
          needCommand(name, no);
          out.push(...scdBlock(bytes, no));
        }
      } else if (candidates.length) {
        const here = candidates.filter((o) => o.state === 'any' || o.state === state);
        const where = candidates[0].state;
        if (!here.length && where === 'command') needCommand(name, no);
        if (!here.length && where !== 'any') fail(no, `${name} runs only in ${STATE_ENTRY[where]}`);
        const arity = (o: EvtOp) => [...o.signature].filter((c) => c !== '0').length;
        const info = here.find((o) => arity(o) === tokens.length);
        if (!info) fail(no, `${name} takes ${here.map(arity).join(' or ')} operands, got ${tokens.length}`);
        const operands = encodeEvtOperands(info, tokens, no);
        if (name === 'anim_look_at' && lookAtIsLong(operands[0]) !== tokens.length > 1) {
          fail(no, 'anim_look_at takes 1 operand when the low 4 bits of its flags are 0, and 6 otherwise; the engine reads its length from the flags');
        }
        if (name === 'evt_kill' && operands[0] >= EVT_SLOTS) {
          fail(no, `evt_kill slot is ${operands[0]}; g_ScdEventTable has slots 0-${EVT_SLOTS - 1}, and the engine writes past it for any other`);
        }
        if (name === 'sleep' || name === 'wait_voice' || name === 'yield') {
          if (name !== 'yield' && loops.length >= EVT_STACK) fail(no, `${name} needs a free stack entry, and ${EVT_STACK} loops are open`);
          loops.forEach((l) => (l.yields = true));
        }
        out.push(...info.code, ...operands);
        if (info.next !== 'same') state = info.next;
      } else if (opcodeByName(name)) {
        needCommand(`SCD command ${name}`, no);
        const command = encodeScdCall(text.slice(0, -1).trim(), no);
        out.push(EVT.SCD_COMMAND, command.length + 2, ...command);
      } else {
        fail(no, `unknown instruction ${name}`);
      }
    } else {
      fail(no, `cannot parse: ${text}`);
    }
  }
  const open = loops.at(-1);
  if (open) fail(open.line, `${open.kind} block is never closed`);
  return Uint8Array.from(out);
}

function assembleProcedure(lines: SourceLine[]): Procedure {
  const drafts: ScdInstruction[] = [];
  const blocks: Block[] = [];
  let offset = 0;

  /** Append an instruction at the current offset. Label arguments start at 0 distance. */
  const emit = (name: string, args: ScdArg[], line: number): void => {
    const info = opcodeByName(name);
    if (!info) fail(line, `unknown instruction ${name}`);
    const draft: ScdInstruction = { offset, opcode: info.opcode, name, args, bytes: new Uint8Array(0) };
    try {
      offset += encodeScd1([draft]).length;
    } catch (err) {
      fail(line, err instanceof Error ? err.message : String(err));
    }
    drafts.push(draft);
  };
  const openBlock = (kind: Block['kind'], line: number) => {
    // An else replaces its if on the engine's branch stack; only an if grows it.
    if (kind === 'if' && blocks.length >= MAX_NESTING) fail(line, `if blocks nest more than ${MAX_NESTING} deep`);
    const label: LabelArg = { kind: 'label', target: offset };
    blocks.push({ kind, label, line });
    emit(kind, [label], line);
  };
  /** Point the block's length at the current offset. */
  const closeBlock = (block: Block) => {
    const length = offset - block.label.target;
    if (length > 0xff) fail(block.line, `${block.kind} block is ${length} bytes, the limit is 255`);
    block.label.target = offset;
  };
  /** Emit `name(arg, arg, ...)` with operands resolved by the instruction's signature. */
  const emitCall = (call: string, line: number) => {
    const { info, args } = parseScdCall(call, line);
    emit(info.name, args, line);
  };

  /** True when the last statement was an `end` outside every block. */
  let endsAtTopLevel = false;
  for (const { no, text } of lines) {
    const before = drafts.length;
    const ifMatch = /^if\s*\((.*)\)\s*\{$/.exec(text);
    if (ifMatch) {
      openBlock('if', no);
      const conditions = ifMatch[1].trim() === 'true' ? [] : ifMatch[1].split('&&');
      for (const condition of conditions) emitCall(condition.trim(), no);
    } else if (/^\}\s*else\s*\{$/.test(text)) {
      // An if block ends where its else begins.
      const top = blocks.pop();
      if (top?.kind !== 'if') fail(no, '"} else {" without an open if block');
      closeBlock(top);
      openBlock('else', no);
    } else if (text === '}') {
      const top = blocks.pop();
      if (!top) fail(no, 'unmatched "}"');
      // An if block ends at an endif instruction; an else block just ends.
      closeBlock(top);
      if (top.kind === 'if') emit('endif', [{ kind: 'num', value: 0 }], no);
    } else if (text === 'return;') {
      emit('end', [{ kind: 'num', value: 0 }], no);
    } else if (text.endsWith(';')) {
      emitCall(text.slice(0, -1), no);
    } else {
      fail(no, `cannot parse: ${text}`);
    }
    // Closing an else block emits nothing, so it never counts as the end.
    endsAtTopLevel = drafts.length > before && drafts.at(-1)?.name === 'end' && blocks.length === 0;
  }
  const open = blocks.at(-1);
  if (open) fail(open.line, `${open.kind} block is never closed`);
  return {
    bytes: encodeScd1(drafts),
    lastLine: lines.at(-1)?.no ?? 0,
    endsWithReturn: endsAtTopLevel,
  };
}
