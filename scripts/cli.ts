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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VirtualNode } from '../shared/types';
import { ImageReader } from '../electron/parsers/imageReader';
import { mountImage } from '../electron/parsers/isoParser';
import { parseTim } from '../electron/parsers/timParser';
import { parseModel } from '../electron/parsers/tmdParser';
import { decodeAdpcm, decodeVag, parseAudio, pcmToWav, vabSamples } from '../electron/parsers/audio/psxAudio';
import { interpretRe1 } from '../electron/parsers/re1/registry';
import { parseRdt1, type Rdt1 } from '../electron/parsers/re1/rdt1';
import { formatScd1 } from '../electron/parsers/re1/scd1';
import { encodePng } from './png';

const USAGE = `usage: pnpm rae <command> ...
  list    <image> [ext]
  find    <image> <substr>
  dump    <image> <path>
  extract <image> <outdir>
  room    <image> <path> | <file.rdt>
  script  <image> <path> | <file.rdt>
  rooms   <image>`;

interface DiscFile {
  node: VirtualNode;
  lba: number;
  size: number;
}

/** A mounted disc: its files plus one open reader for byte reads. */
interface Disc {
  files: DiscFile[];
  reader: ImageReader;
}

function openDisc(image: string): Disc {
  const { root, descriptors } = mountImage(image);
  const files: DiscFile[] = [];
  const walk = (node: VirtualNode) => {
    const desc = descriptors.get(node.id);
    if (node.type === 'file' && desc) files.push({ node, lba: desc.lba, size: desc.size });
    node.children?.forEach(walk);
  };
  walk(root);
  return { files, reader: new ImageReader(image) };
}

function readFile(disc: Disc, file: DiscFile): Buffer {
  const bytes = disc.reader.readLogical(file.lba, file.size);
  if (bytes.length !== file.size) {
    throw new Error(`${file.node.path}: image ends after ${bytes.length} of ${file.size} bytes`);
  }
  return bytes;
}

function findFile(disc: Disc, query: string): DiscFile {
  const q = query.toLowerCase();
  const hit =
    disc.files.find((f) => f.node.path.toLowerCase() === q) ??
    disc.files.find((f) => f.node.path.toLowerCase().endsWith(q));
  if (!hit) fail(`file not found on disc: ${query}`);
  return hit;
}

/** Stop with a message. The top level prints it and sets the exit code. */
function fail(message: string): never {
  throw new Error(message);
}

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

function scriptReport(rdt: Rdt1): string {
  const block = (kind: string, procs: Rdt1['init']) =>
    procs.map((p, i) => `// ${kind} procedure ${i} @ 0x${p.offset.toString(16)}\n${formatScd1(p.instructions)}`);
  return [...block('init', rdt.init), ...block('main', rdt.main)].join('\n\n') + '\n';
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
  } else if (ext === 'rdt') {
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
    writeFileSync(path.join(dir, 'script.c'), scriptReport(rdt));
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
        const rdt = parseRdt1(new Uint8Array(readFile(disc, file)));
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
      process.stdout.write(scriptReport(parseRdt1(new Uint8Array(bytes))));
      return;
    }
    case 'rooms': {
      const [image] = args;
      if (!image) fail(USAGE);
      roomsIndex(image);
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
