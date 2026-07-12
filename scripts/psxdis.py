# Minimal PS-X EXE (MIPS R3000) disassembler + analysis helper.
# Usage: python scripts/psxdis.py <file.exe> [header|find <hexbytes>|disasm <vaddr> <count>]
import sys, struct
from capstone import Cs, CS_ARCH_MIPS, CS_MODE_MIPS32, CS_MODE_LITTLE_ENDIAN

def load(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'PS-X EXE', 'not a PS-X EXE'
    pc0   = struct.unpack_from('<I', data, 0x10)[0]
    gp0   = struct.unpack_from('<I', data, 0x14)[0]
    taddr = struct.unpack_from('<I', data, 0x18)[0]
    tsize = struct.unpack_from('<I', data, 0x1c)[0]
    text  = data[0x800:0x800 + tsize]
    return {'data': data, 'pc0': pc0, 'gp0': gp0, 'taddr': taddr, 'tsize': tsize, 'text': text}

def main():
    path = sys.argv[1]
    cmd  = sys.argv[2] if len(sys.argv) > 2 else 'header'
    exe  = load(path)
    if cmd == 'header':
        print(f"entry(pc0) = 0x{exe['pc0']:08x}")
        print(f"gp0        = 0x{exe['gp0']:08x}")
        print(f"text load  = 0x{exe['taddr']:08x}  size = {exe['tsize']} (0x{exe['tsize']:x})")
        print(f"text ends  = 0x{exe['taddr']+exe['tsize']:08x}")
        return
    if cmd == 'find':
        needle = bytes.fromhex(sys.argv[3])
        i = exe['data'].find(needle)
        while i != -1:
            print(f"@file 0x{i:x}" + (f"  vaddr 0x{exe['taddr']+(i-0x800):08x}" if i >= 0x800 else ""))
            i = exe['data'].find(needle, i + 1)
        return
    if cmd == 'disasm':
        vaddr = int(sys.argv[3], 0)
        count = int(sys.argv[4]) if len(sys.argv) > 4 else 40
        off = vaddr - exe['taddr']
        md = Cs(CS_ARCH_MIPS, CS_MODE_MIPS32 | CS_MODE_LITTLE_ENDIAN)
        for ins in md.disasm(exe['text'][off:off + count * 4], vaddr):
            print(f"0x{ins.address:08x}:  {ins.mnemonic:<8} {ins.op_str}")
            count -= 1
            if count <= 0:
                break
        return
    print('unknown command', cmd)

if __name__ == '__main__':
    main()
