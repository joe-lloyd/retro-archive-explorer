// Minimal PS-X EXE (MIPS R3000, little-endian) disassembler for the in-app
// "Disasm" tab. Covers the common integer/branch/memory opcodes — enough to
// read the game's code and find the routines that load/parse files.

const REG = [
  '$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3',
  '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
  '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
  '$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra',
];

const hex = (n: number) => '0x' + (n >>> 0).toString(16);
const simm = (n: number) => (n & 0x8000 ? -((~n & 0xffff) + 1) : n);

function decode(instr: number, pc: number): string {
  if (instr === 0) return 'nop';
  const op = instr >>> 26;
  const rs = (instr >>> 21) & 31;
  const rt = (instr >>> 16) & 31;
  const rd = (instr >>> 11) & 31;
  const sh = (instr >>> 6) & 31;
  const fn = instr & 63;
  const imm = instr & 0xffff;
  const tgt = instr & 0x03ffffff;
  const R = (i: number) => REG[i];
  const bt = hex((pc + 4 + simm(imm) * 4) >>> 0); // branch target
  const jt = hex(((pc + 4) & 0xf0000000) | (tgt << 2)); // jump target

  if (op === 0) {
    switch (fn) {
      case 0x00: return `sll     ${R(rd)}, ${R(rt)}, ${sh}`;
      case 0x02: return `srl     ${R(rd)}, ${R(rt)}, ${sh}`;
      case 0x03: return `sra     ${R(rd)}, ${R(rt)}, ${sh}`;
      case 0x04: return `sllv    ${R(rd)}, ${R(rt)}, ${R(rs)}`;
      case 0x06: return `srlv    ${R(rd)}, ${R(rt)}, ${R(rs)}`;
      case 0x07: return `srav    ${R(rd)}, ${R(rt)}, ${R(rs)}`;
      case 0x08: return `jr      ${R(rs)}`;
      case 0x09: return `jalr    ${R(rd)}, ${R(rs)}`;
      case 0x0c: return 'syscall';
      case 0x0d: return 'break';
      case 0x10: return `mfhi    ${R(rd)}`;
      case 0x11: return `mthi    ${R(rs)}`;
      case 0x12: return `mflo    ${R(rd)}`;
      case 0x13: return `mtlo    ${R(rs)}`;
      case 0x18: return `mult    ${R(rs)}, ${R(rt)}`;
      case 0x19: return `multu   ${R(rs)}, ${R(rt)}`;
      case 0x1a: return `div     ${R(rs)}, ${R(rt)}`;
      case 0x1b: return `divu    ${R(rs)}, ${R(rt)}`;
      case 0x20: return `add     ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x21: return `addu    ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x22: return `sub     ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x23: return `subu    ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x24: return `and     ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x25: return `or      ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x26: return `xor     ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x27: return `nor     ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x2a: return `slt     ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      case 0x2b: return `sltu    ${R(rd)}, ${R(rs)}, ${R(rt)}`;
      default: return `.word   ${hex(instr)}`;
    }
  }
  switch (op) {
    case 0x01: // REGIMM
      if (rt === 0) return `bltz    ${R(rs)}, ${bt}`;
      if (rt === 1) return `bgez    ${R(rs)}, ${bt}`;
      if (rt === 0x10) return `bltzal  ${R(rs)}, ${bt}`;
      if (rt === 0x11) return `bgezal  ${R(rs)}, ${bt}`;
      return `.word   ${hex(instr)}`;
    case 0x02: return `j       ${jt}`;
    case 0x03: return `jal     ${jt}`;
    case 0x04: return `beq     ${R(rs)}, ${R(rt)}, ${bt}`;
    case 0x05: return `bne     ${R(rs)}, ${R(rt)}, ${bt}`;
    case 0x06: return `blez    ${R(rs)}, ${bt}`;
    case 0x07: return `bgtz    ${R(rs)}, ${bt}`;
    case 0x08: return `addi    ${R(rt)}, ${R(rs)}, ${simm(imm)}`;
    case 0x09: return `addiu   ${R(rt)}, ${R(rs)}, ${simm(imm)}`;
    case 0x0a: return `slti    ${R(rt)}, ${R(rs)}, ${simm(imm)}`;
    case 0x0b: return `sltiu   ${R(rt)}, ${R(rs)}, ${simm(imm)}`;
    case 0x0c: return `andi    ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0d: return `ori     ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0e: return `xori    ${R(rt)}, ${R(rs)}, ${hex(imm)}`;
    case 0x0f: return `lui     ${R(rt)}, ${hex(imm)}`;
    case 0x10: return `cop0    ${hex(instr & 0x1ffffff)}`;
    case 0x12: return `cop2    ${hex(instr & 0x1ffffff)}`; // GTE
    case 0x20: return `lb      ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x21: return `lh      ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x23: return `lw      ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x24: return `lbu     ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x25: return `lhu     ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x28: return `sb      ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x29: return `sh      ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x2b: return `sw      ${R(rt)}, ${simm(imm)}(${R(rs)})`;
    case 0x32: return `lwc2    ${hex(instr & 0xffff)}(${R(rs)})`;
    case 0x3a: return `swc2    ${hex(instr & 0xffff)}(${R(rs)})`;
    default: return `.word   ${hex(instr)}`;
  }
}

/** Disassemble a PS-X EXE's text section into a listing (capped for display). */
export function disassembleExe(buffer: Buffer, maxInstr = 8000): string {
  if (buffer.toString('latin1', 0, 8) !== 'PS-X EXE') {
    throw new Error('not a PS-X EXE');
  }
  const pc0 = buffer.readUInt32LE(0x10);
  const taddr = buffer.readUInt32LE(0x18);
  const tsize = buffer.readUInt32LE(0x1c);
  const text = buffer.subarray(0x800, 0x800 + tsize);

  const lines: string[] = [
    `; PS-X EXE  entry=${hex(pc0)}  text=${hex(taddr)}  size=${tsize} (${hex(tsize)})`,
    '',
  ];
  const count = Math.min(Math.floor(text.length / 4), maxInstr);
  for (let i = 0; i < count; i++) {
    const vaddr = (taddr + i * 4) >>> 0;
    const instr = text.readUInt32LE(i * 4);
    const marker = vaddr === pc0 ? ' <- entry' : '';
    lines.push(`${hex(vaddr).padStart(10)}:  ${decode(instr, vaddr)}${marker}`);
  }
  if (Math.floor(text.length / 4) > maxInstr) {
    lines.push(`; … ${Math.floor(text.length / 4) - maxInstr} more instructions`);
  }
  return lines.join('\n');
}
