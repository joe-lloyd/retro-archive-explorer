// RE1 room script assembler: the inverse of `formatScd1`.
//
// Input is the pseudo-C that `pnpm rae script` prints. Each procedure starts
// with a `// init procedure N` or `// main procedure N` header (anything after
// that, such as `@ 0x11e`, is ignored). Block lengths are recomputed from the
// content, so lines can be added or removed. Comments and the `/* Beretta */`
// notes after operands are dropped.
import { encodeScd1, opcodeByName, parseConstant, type ScdArg, type ScdInstruction } from './scd1';

export type ScriptKind = 'init' | 'main';

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

const HEADER = /^\/\/\s*(init|main)\s+procedure\b/;
const NUMBER = /^(-?)(\d+|0x[0-9a-f]+)$/i;

function fail(line: number, message: string): never {
  throw new Error(`line ${line}: ${message}`);
}

export function assembleScd1(text: string): AssembledScripts {
  const procedures: Record<ScriptKind, SourceLine[][]> = { init: [], main: [] };
  let current: SourceLine[] | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    const header = HEADER.exec(raw.trim());
    if (header) {
      current = [];
      procedures[header[1] as ScriptKind].push(current);
      return;
    }
    const code = raw.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').trim();
    if (!code) return;
    if (!current) fail(no, 'code before the first "// init procedure" or "// main procedure" header');
    current.push({ no, text: code });
  });
  return {
    init: procedures.init.map(assembleProcedure),
    main: procedures.main.map(assembleProcedure),
  };
}

function assembleProcedure(lines: SourceLine[]): Uint8Array {
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
    emit(name, args, line);
  };

  for (const { no, text } of lines) {
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
  }
  const open = blocks.at(-1);
  if (open) fail(open.line, `${open.kind} block is never closed`);
  return encodeScd1(drafts);
}
