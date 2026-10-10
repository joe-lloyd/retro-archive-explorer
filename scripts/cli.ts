// Headless CLI over the app's own parsers. Run with `pnpm rae <command>`.
//
//   list    <image> [ext]            list files, optionally by extension
//   find    <image> <substr>         list files whose path contains substr
//   dump    <image> <path>           write diagnostics/<name>.json + raw bytes
//   extract <image> <outdir>         copy every file out, converting what it can:
//                                    TIM -> PNG, VAG -> WAV, VAB -> WAV samples,
//                                    RDT -> sections, script.c and room.json
//   room    <image> <path> | <file.rdt>   room summary: cameras, enemies, items, doors
//   script  <image> <path> | <file.rdt>   decompiled init and main room scripts
//   rooms   <image>                  one line per room across the whole disc
//   asm     <script.c> <in.rdt> <out.rdt>   assemble script text into a copy of a room
//   flags   <image | dir>            which rooms check and set each flag, and which are unused
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VirtualNode } from '../shared/types';
import { fail, findFile, openDisc, readFile, roomFiles } from './disc';
import { parseTim } from '../electron/parsers/timParser';
import { parseModel } from '../electron/parsers/tmdParser';
import { decodeAdpcm, decodeVag, parseAudio, pcmToWav, vabSamples } from '../electron/parsers/audio/psxAudio';
import { interpretRe1 } from '../electron/parsers/re1/registry';
import { formatScripts, isEmptyRoomSlot, parseRdt1, replaceRdtSections, type Rdt1 } from '../electron/parsers/re1/rdt1';
import { assembleScd1 } from '../electron/parsers/re1/scdAsm';
import { encodeScd1, enemyName, FLAG_GROUPS, type ScdArg } from '../electron/parsers/re1/scd1';
import { encodePng } from './png';

const USAGE = `usage: pnpm rae <command> ...
  list    <image> [ext]
  find    <image> <substr>
  dump    <image> <path>
  extract <image> <outdir>
  room    <image> <path> | <file.rdt>
  script  <image> <path> | <file.rdt>
  rooms   <image>
  swap-enemy <in.rdt> <out.rdt> <from-type> <to-type> [kill-id]
  asm     <script.c> <in.rdt> <out.rdt>
  flags   <image | dir>`;

/** `<image> <path>` reads from the disc; a lone existing file path reads it directly. */
function loadTarget(args: string[]): { name: string; bytes: Buffer } {
  const [first, second] = args;
  if (!first) fail(USAGE);
  if (!second) {
    if (!existsSync(first)) fail(`no such file: ${first}`);
    return { name: path.basename(first), bytes: readFileSync(first) };
  }
  const disc = openDisc(first);
  try {
    const file = findFile(disc, second);
    return { name: file.node.name, bytes: readFile(disc, file) };
  } finally {
    disc.reader.close();
  }
}

function hexDump(buf: Buffer, len: number): string {
  const rows: string[] = [];
  for (let off = 0; off < Math.min(buf.length, len); off += 16) {
    const slice = buf.subarray(off, off + 16);
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    rows.push(`${off.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return rows.join('\n');
}

/** Every offset where a 4-byte little-endian magic appears. */
function findMagic(buf: Buffer, magic: number, cap = 64): number[] {
  const hits: number[] = [];
  for (let i = 0; i + 4 <= buf.length && hits.length < cap; i += 4) {
    if (buf.readUInt32LE(i) === magic) hits.push(i);
  }
  return hits;
}

function u32Table(buf: Buffer, count: number): { offset: number; value: number; hex: string }[] {
  const rows = [];
  for (let i = 0; i < count && (i + 1) * 4 <= buf.length; i++) {
    const value = buf.readUInt32LE(i * 4);
    rows.push({ offset: i * 4, value, hex: '0x' + value.toString(16) });
  }
  return rows;
}

function summarizeParse(ext: string | undefined, node: VirtualNode, bytes: Buffer): unknown {
  try {
    if (ext === 'tim') {
      const t = parseTim(bytes);
      return { ok: true, kind: 'texture', width: t.width, height: t.height, bitDepth: t.bitDepth };
    }
    if (ext && ['tmd', 'emd', 'ivm', 'dor'].includes(ext)) {
      const m = parseModel(bytes, ext);
      return {
        ok: true,
        kind: 'model',
        objects: m.objects.length,
        triangles: m.objects.reduce((n, o) => n + o.triangleCount, 0),
        textured: !!m.texture,
        perObject: m.objects.map((o) => ({ name: o.name, tris: o.triangleCount, hasColor: !!o.colors, hasUv: !!o.uvs })),
      };
    }
    if (ext && ['vag', 'vab', 'vb', 'vh', 'xa', 'wav', 'snd', 'hed'].includes(ext)) {
      const a = parseAudio(bytes, ext);
      return { ok: true, kind: 'audio', mime: a.mime, bytes: a.bytes.length, note: a.note };
    }
    const re1 = interpretRe1(ext, node, new Uint8Array(bytes));
    if (re1) return { ok: true, kind: re1.kind, format: 'format' in re1 ? re1.format : undefined };
    return { ok: false, note: 'no parser for extension' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function fmtVec(v: { x: number; y: number; z: number }): string {
  return `(${v.x}, ${v.y}, ${v.z})`;
}

function roomReport(name: string, rdt: Rdt1): string {
  const h = rdt.header;
  const out = [
    `${name}: ${h.cameras} cameras, ${h.objectModels} object models, ${h.items} item models, ${h.doors} doors`,
    '',
    'cameras',
    ...rdt.cameras.map((c) => `  ${c.index}: from ${fmtVec(c.from)} to ${fmtVec(c.to)}`),
    '',
    `camera switch zones: ${rdt.cameraSwitches.length}`,
    '',
    'placements',
    ...rdt.placements.map((p) => {
      switch (p.kind) {
        case 'enemy':
          return `  enemy #${p.id}  ${p.name} [${p.type}] at ${fmtVec(p.pos)} facing ${p.facing}`;
        case 'item':
          return `  item  #${p.id}  ${p.name} x${p.amount} at (${p.x}, ${p.z})`;
        case 'door':
          return `  door  #${p.id}  -> ${p.target} at (${p.x}, ${p.z}), arrive ${fmtVec(p.next)}, lock ${p.lock}`;
        default: {
          const exhaustive: never = p;
          return exhaustive;
        }
      }
    }),
    '',
    'sections',
    ...rdt.sections.map((s) => `  0x${s.offset.toString(16).padStart(6, '0')} ${String(s.size).padStart(7)}  ${s.name}`),
    '',
    `events: ${rdt.events.length}`,
  ];
  return out.join('\n');
}

/**
 * Write a converted copy next to the raw file when the format is understood.
 * Returns errors from sections that failed inside a container.
 */
function convert(ext: string | undefined, bytes: Buffer, dest: string): string[] {
  if (ext === 'tim') {
    const t = parseTim(bytes);
    writeFileSync(`${dest}.png`, encodePng(t.width, t.height, t.pixels));
  } else if (ext === 'vag') {
    writeFileSync(`${dest}.wav`, decodeVag(bytes).wav);
  } else if (ext === 'vab') {
    vabSamples(bytes).forEach((s, i) => {
      const pcm = decodeAdpcm(bytes.subarray(s.offset, s.offset + s.size));
      writeFileSync(`${dest}.${String(i).padStart(3, '0')}.wav`, pcmToWav(pcm, 22050));
    });
  } else if (ext === 'rdt' && !isEmptyRoomSlot(bytes)) {
    const rdt = parseRdt1(new Uint8Array(bytes));
    const errors: string[] = [];
    const dir = `${dest}.d`;
    mkdirSync(dir, { recursive: true });
    for (const s of rdt.sections) {
      const part = bytes.subarray(s.offset, s.offset + s.size);
      const file = path.join(dir, `${s.offset.toString(16).padStart(6, '0')}_${s.name}`);
      writeFileSync(file, part);
      if (s.name.endsWith('.tim')) errors.push(...tryConvert('tim', part, file).map((e) => `${s.name}: ${e}`));
    }
    writeFileSync(path.join(dir, 'script.c'), formatScripts(rdt));
    writeFileSync(path.join(dir, 'room.txt'), roomReport(path.basename(dest), rdt) + '\n');
    writeFileSync(path.join(dir, 'room.json'), JSON.stringify(rdt, (k, v) => (k === 'bytes' ? undefined : v), 2));
    return errors;
  }
  return [];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tryConvert(ext: string | undefined, bytes: Buffer, dest: string): string[] {
  try {
    return convert(ext, bytes, dest);
  } catch (err) {
    return [message(err)];
  }
}

function extract(image: string, outDir: string): void {
  const disc = openDisc(image);
  let failures = 0;
  try {
    for (const file of disc.files) {
      const dest = path.join(outDir, file.node.path);
      mkdirSync(path.dirname(dest), { recursive: true });
      let errors: string[];
      try {
        const bytes = readFile(disc, file);
        writeFileSync(dest, bytes);
        errors = tryConvert(file.node.extension, bytes, dest);
      } catch (err) {
        errors = [message(err)];
      }
      for (const error of errors) console.error(`failed: ${file.node.path}: ${error}`);
      if (errors.length) failures++;
    }
  } finally {
    disc.reader.close();
  }
  console.log(`extracted ${disc.files.length} files to ${outDir} (${failures} with failures)`);
  if (failures) process.exitCode = 1;
}

function roomsIndex(image: string): void {
  const disc = openDisc(image);
  try {
    for (const file of disc.files.filter((f) => f.node.extension === 'rdt')) {
      try {
        const bytes = new Uint8Array(readFile(disc, file));
        if (isEmptyRoomSlot(bytes)) {
          console.log(`${file.node.path}  empty room slot`);
          continue;
        }
        const rdt = parseRdt1(bytes);
        const names = (kind: string) =>
          rdt.placements.flatMap((p) => (p.kind === kind && 'name' in p ? [p.name] : []));
        const doors = rdt.placements.flatMap((p) => (p.kind === 'door' ? [p.target] : []));
        console.log(
          [
            file.node.path,
            `cams ${rdt.header.cameras}`,
            `enemies [${names('enemy').join(', ')}]`,
            `items [${names('item').join(', ')}]`,
            `doors [${doors.join(', ')}]`,
          ].join('  '),
        );
      } catch (err) {
        console.log(`${file.node.path}  parse error: ${message(err)}`);
      }
    }
  } finally {
    disc.reader.close();
  }
}

/**
 * Copy a room file with every enemy() of one type changed to another. The
 * script decoder finds the instructions, so only their type byte (the first
 * operand, right after the opcode) changes. A kill id narrows it to one enemy.
 */
function argValue(arg: ScdArg | undefined): number | undefined {
  return arg && arg.kind !== 'label' ? arg.value : undefined;
}

function swapEnemy(args: string[]): void {
  const [src, dest, from, to, kill] = args;
  const num = (v: string | undefined, what: string): number => {
    const n = Number(v);
    if (v === undefined || v.trim() === '' || !Number.isInteger(n) || n < 0 || n > 0xff) {
      fail(`${what} must be a byte, got '${v ?? ''}'`);
    }
    return n;
  };
  if (!src || !dest) fail(USAGE);
  if (path.resolve(src) === path.resolve(dest)) fail('out.rdt must differ from in.rdt; swap-enemy writes a copy');
  const [fromType, toType] = [num(from, 'from-type'), num(to, 'to-type')];
  const killId = kill === undefined ? undefined : num(kill, 'kill-id');
  if (!existsSync(src)) fail(`no such file: ${src}`);
  const bytes = readFileSync(src);
  const rdt = parseRdt1(new Uint8Array(bytes));
  const hits = [...rdt.init, ...rdt.main]
    .flatMap((p) => p.instructions)
    .filter((ins) => ins.name === 'enemy')
    .filter((ins) => argValue(ins.args[0]) === fromType && (killId === undefined || argValue(ins.args[2]) === killId));
  if (hits.length === 0) fail(`no enemy of type ${fromType} in ${src}`);
  for (const ins of hits) bytes[ins.offset + 1] = toType;
  writeFileSync(dest, bytes);
  for (const ins of hits) console.log(`0x${ins.offset.toString(16)}: ${enemyName(fromType)} -> ${enemyName(toType)}`);
}

/**
 * Assemble script text (the format `script` prints) and write a copy of a room
 * whose init and main procedures are the assembled ones. A script section with
 * no procedures in the text keeps the room's own.
 */
function asm(args: string[]): void {
  const [scriptPath, src, dest] = args;
  if (!scriptPath || !src || !dest) fail(USAGE);
  for (const file of [scriptPath, src]) if (!existsSync(file)) fail(`no such file: ${file}`);
  const scripts = assembleScd1(readFileSync(scriptPath, 'utf8'));
  if (scripts.init.length + scripts.main.length === 0) {
    fail(`${scriptPath} has no "// init procedure" or "// main procedure" blocks`);
  }
  const out = replaceRdtSections(new Uint8Array(readFileSync(src)), {
    init: scripts.init.length ? scripts.init : undefined,
    main: scripts.main.length ? scripts.main : undefined,
  });
  // Read the new room back to prove the writer produced what was assembled.
  const room = parseRdt1(out);
  for (const kind of ['init', 'main'] as const) {
    const written = room[kind].map((p) => encodeScd1(p.instructions));
    const want = scripts[kind];
    if (want.length && (written.length !== want.length || written.some((w, i) => !Buffer.from(w).equals(want[i])))) {
      fail(`${kind} procedures read back from the new room differ from the assembled ones`);
    }
  }
  writeFileSync(dest, out);
  const describe = (kind: 'init' | 'main') =>
    scripts[kind].length
      ? `${kind} ${scripts[kind].length} procedure(s) at 0x${room[kind][0].offset.toString(16)}`
      : `${kind} unchanged`;
  console.log(`wrote ${dest}: ${describe('init')}, ${describe('main')}`);
}

interface FlagUse {
  checkedBy: Set<string>;
  setBy: Set<string>;
}

/** [0, 1, 2, 5] -> "0-2, 5" */
function ranges(values: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    let j = i;
    while (values[j + 1] === values[j] + 1) j++;
    parts.push(j > i ? `${values[i]}-${values[j]}` : String(values[i]));
    i = j;
  }
  return parts.join(', ');
}

/**
 * For every flag group and index: the rooms whose init or main script tests it
 * (ck) and the rooms that write it (set). Indexes no room touches are listed
 * per group. Event scripts are not decoded, so they may still use those.
 */
function flagsReport(target: string): string {
  const uses = new Map<number, Map<number, FlagUse>>();
  for (const room of roomFiles(target)) {
    if (room.bytes.length < 0x94) continue;
    const name = path.basename(room.name.replace(/\\/g, '/'), path.extname(room.name));
    const rdt = parseRdt1(room.bytes);
    for (const ins of [...rdt.init, ...rdt.main].flatMap((p) => p.instructions)) {
      if (ins.name !== 'ck' && ins.name !== 'set') continue;
      const group = argValue(ins.args[0]);
      const index = argValue(ins.args[1]);
      if (group === undefined || index === undefined) continue;
      const byIndex = uses.get(group) ?? new Map<number, FlagUse>();
      uses.set(group, byIndex);
      const use = byIndex.get(index) ?? { checkedBy: new Set(), setBy: new Set() };
      byIndex.set(index, use);
      (ins.name === 'ck' ? use.checkedBy : use.setBy).add(name);
    }
  }
  const lines: string[] = [];
  const groups = [...new Set([...FLAG_GROUPS.keys(), ...uses.keys()])].sort((a, b) => a - b);
  for (const group of groups) {
    const byIndex = uses.get(group) ?? new Map<number, FlagUse>();
    lines.push(`${FLAG_GROUPS[group] ?? `FG_${group}`} (group ${group}): ${byIndex.size} of 256 indexes used`);
    for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
      const use = byIndex.get(index);
      if (!use) continue;
      lines.push(
        `  ${String(index).padStart(3)}  checked by [${[...use.checkedBy].join(' ')}]  set by [${[...use.setBy].join(' ')}]`,
      );
    }
    const unused = Array.from({ length: 256 }, (_, i) => i).filter((i) => !byIndex.has(i));
    lines.push(`  never used: ${unused.length ? ranges(unused) : 'none'}`, '');
  }
  lines.push('Only init and main scripts are read. Event scripts are not decoded, so an unused index may still be used there.');
  return lines.join('\n');
}

function main(): void {
  const [mode, ...args] = process.argv.slice(2);
  switch (mode) {
    case 'list':
    case 'find': {
      const [image, arg] = args;
      if (!image) fail(USAGE);
      const disc = openDisc(image);
      disc.reader.close();
      const needle = arg?.toLowerCase();
      const rows = disc.files
        .filter((f) =>
          !needle ? true : mode === 'list' ? f.node.extension === needle : f.node.path.toLowerCase().includes(needle),
        )
        .map((f) => `${f.size.toString().padStart(9)}  ${f.node.path}`);
      console.log(`${rows.join('\n')}\n\n${rows.length} file(s)`);
      return;
    }
    case 'dump': {
      const [image, query] = args;
      if (!image || !query) fail(USAGE);
      const disc = openDisc(image);
      const file = findFile(disc, query);
      const bytes = readFile(disc, file);
      disc.reader.close();
      const report = {
        path: file.node.path,
        size: bytes.length,
        extension: file.node.extension,
        magic: {
          u32le: bytes.length >= 4 ? '0x' + bytes.readUInt32LE(0).toString(16) : '',
          ascii: bytes.subarray(0, 8).toString('latin1').replace(/[^\x20-\x7e]/g, '.'),
        },
        headerU32Table: u32Table(bytes, 24),
        tmdMagicAt: findMagic(bytes, 0x41),
        timMagicAt: findMagic(bytes, 0x10),
        parse: summarizeParse(file.node.extension, file.node, bytes),
        hexHead: hexDump(bytes, 512),
      };
      mkdirSync('diagnostics', { recursive: true });
      writeFileSync(path.join('diagnostics', `${file.node.name}.json`), JSON.stringify(report, null, 2));
      writeFileSync(path.join('diagnostics', file.node.name), bytes);
      console.log(`wrote diagnostics/${file.node.name}.json and diagnostics/${file.node.name}`);
      console.log(JSON.stringify({ ...report, hexHead: '(in file)' }, null, 2));
      return;
    }
    case 'extract': {
      const [image, outDir] = args;
      if (!image || !outDir) fail(USAGE);
      extract(image, outDir);
      return;
    }
    case 'room': {
      const { name, bytes } = loadTarget(args);
      console.log(roomReport(name, parseRdt1(new Uint8Array(bytes))));
      return;
    }
    case 'script': {
      const { bytes } = loadTarget(args);
      process.stdout.write(formatScripts(parseRdt1(new Uint8Array(bytes))));
      return;
    }
    case 'rooms': {
      const [image] = args;
      if (!image) fail(USAGE);
      roomsIndex(image);
      return;
    }
    case 'swap-enemy':
      swapEnemy(args);
      return;
    case 'asm':
      asm(args);
      return;
    case 'flags': {
      const [target] = args;
      if (!target) fail(USAGE);
      console.log(flagsReport(target));
      return;
    }
    default:
      fail(USAGE);
  }
}

try {
  main();
} catch (err) {
  console.error(message(err));
  process.exitCode = 1;
}
