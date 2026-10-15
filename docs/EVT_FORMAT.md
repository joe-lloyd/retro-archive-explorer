# RE1 event scripts (EVT)

An RE1 room runs three kinds of script. The init and main procedures (SCD) run
through `run_command_functions`. Event scripts are a separate bytecode, run by
a small VM in `room_events_check`. The game uses them for cutscenes, scripted
enemy moves and anything else that has to take more than one frame.

This page describes the format as the engine reads it. Function names and
addresses come from the decompiled PC port
([resident-evil-pc-decomp](https://github.com/joe-lloyd/resident-evil-pc-decomp)),
mostly `src/game/RoomEvents.cpp`. The parser is
[`electron/parsers/re1/evt1.ts`](../electron/parsers/re1/evt1.ts) and the
assembler is `assembleEvent` in
[`electron/parsers/re1/scdAsm.ts`](../electron/parsers/re1/scdAsm.ts).

## Where the scripts are

Entry 8 of the room's offset table (file offset 0x68) points at the events
section. The section starts with a table of u32 offsets, one per script. The
offsets are relative to the start of the table, and a 0 entry ends it. The
scripts follow the table.

`LoadRoomRdt` (0x00477d90, the loop at 0x00477f2d) rewrites each entry up to the
0 into an address by adding the table's own address, and stores the table in
`g_RoomEventScripts` (0x00d213b4). Nothing else points into the section, so the
whole section can move as long as the 0x68 entry moves with it.

Retail rooms store the scripts in table order, directly after the table, each
padded with zero bytes to a 4-byte boundary. A room with no scripts has a
section of four zero bytes. The engine does not need the padding, but the
writer keeps it so a round trip gives back the same bytes.

Script N has no stored length. The parser takes the bytes from its offset to the
next script's offset, or to the end of the section for the last one.

## How a script starts

An event runs in one of the 8 slots of `g_ScdEventTable` (0x00bf084c). Each slot
is a `ScdEventEntry` of 0x34 bytes: a state, an active flag, the entity it
drives, its instruction pointer, and three stacks of 4 entries for loops and
waits.

- The SCD command `evt_exec(0, slot, script)` (opcode 0x14,
  `cmd_scd_event_create` at 0x00461040) starts script `script` in slot `slot`.
  In `rae script` output the script index prints as `5 /* event_05 */`.
- The event op `evt_start(slot, script)` does the same from inside an event.

Both call `ScdEventEntry_Create` (0x0041d650). A slot above 7 means the first
free slot, or slot 7 when none is free. `ScdEventEntry_Init` (0x0041d620) marks
the slot active, sets the state to command, points the slot at the script,
empties its stacks, and sets the entity to the current `ENTITY`.

## How the VM runs

`room_events_check` (0x0041d6a0) runs once every frame from `game_loop`, and
once from `room_set` (0x00477c45). It does nothing unless bit 7 of
`g_message_flags` is set. Then, for each active slot, it runs ops one after the
other until one of them yields the frame.

Each byte is read in one of three states, held in `ScdEventEntry.state`:

| State | Value | Entered by | Left by |
| --- | --- | --- | --- |
| command | 0 | the start of a script, `evt_jump` | `anim_begin`, `move_begin`, `move_begin_reset` |
| anim | 1 | `anim_begin` | `anim_end`, `anim_end_release` |
| move | 2 | `move_begin`, `move_begin_reset` | `move_end` |

The VM first tests the byte against the control ops 0xF6 to 0xFF, which work
the same in every state. Any other byte is looked up in the table of the
current state. The same byte can mean three different things: 0x01 is
`anim_begin` in the command state and `move_end` in the move state, and the
anim state has no op 0x01 at all. A disassembler has to follow the state from
the script's start, and `readEvt1` does that.

The dispatcher has a fourth state, 3 (`scd_event_state3_set_behavior`,
0x0041e150), but no op ever enters it, so the format leaves it out.

### Ending and waiting

A script ends when it reaches `return;` (0xFF). The slot becomes inactive. At
each yield the VM also checks whether the next byte is 0xFF (0x0041d99d) and
ends the script there without running it.

A byte the current state has no op for stops the script in one of two ways:

- In the command state the VM deactivates the slot and returns from
  `room_events_check` at once, so the slots after it skip this frame.
- In the anim and move states the handler returns without moving the
  instruction pointer, and the VM reads the same byte again in the same frame,
  forever. The game hangs.

A script that has no `return;` runs on into the bytes after it: the padding,
which is a nop in every state, then the next script. 21 retail scripts end
that way.

Only these ops yield the frame: `yield`, `sleep`, `wait_voice`, `return` and
`evt_jump`. `repeat` and `do` loops do not yield on their own, so a loop that
must wait has to contain one of them.

## Opcodes

Operand types: u8 and s8 are bytes, u16 and s16 are little-endian 16-bit
values. A byte shown as `00` is one the engine skips; the assembler writes 0
and the text does not show it. Length is the full instruction in bytes.

### Control, read in every state

The handlers are inline in `room_events_check`.

| Text | Bytes | Length | What it does |
| --- | --- | --- | --- |
| `wait_voice();` | `F6 F7` | 2 | Waits until the voice line started by SCD `xa_on` (0x1E, which sets `MSF_VOICE_PLAYING`) ends and no menu choice is open (`g_menu_choice_id & 0x80`, tested at 0x0041d918). Yields every frame, at least once. F6 pushes a stack entry; F7 tests, pops and moves on. |
| `sleep(n);` | `F8 F9 n:u16` | 4 | Waits n frames. F8 pushes a counter of n and falls into F9, which counts it down once per frame and moves on at 0. n is 1 to 65535; 0 would wait 65536 frames. |
| `repeat (n) { ... }` | `FA 00 n:u16` ... `FB` | 4, 1 | Runs the body n times. FA pushes a counter and the body's address; FB counts down and jumps back until 0. Neither yields. |
| `do { ... } while (cmd);` | `FC LL cmd` ... `FD` | LL, 1 | FC stores the address of `cmd`, one SCD command of LL - 2 bytes, and jumps over it to the body. FD runs `cmd` through `script_command_funcs_table` and jumps back to the body while it returns nonzero, the value that makes an SCD `if` take its block. Retail scripts use it to wait for a flag: `do { yield(); } while (ck(FG_ROOM, 33, 1));`. |
| `yield();` | `FE` | 1 | Ends the frame for this slot. |
| `return;` | `FF` | 1 | Deactivates the slot. |

F7 and F9 only appear as the second byte of the pairs above. F6 and F8 move the
pointer one byte and fall into them, and the next frame reads them on their
own, so a lone F7 or F9, or F6 or F8 followed by anything else, does not do
what the pair does. The parser keeps such bytes as `raw`.

The return, call and counter stacks hold 4 entries. Each open `repeat` or `do`
takes one, and `sleep` and `wait_voice` take one while they wait.

### Command state

| Text | Bytes | Length | Handler | What it does |
| --- | --- | --- | --- | --- |
| `evt_nop();` | `00` | 1 | inline | Nothing. |
| `anim_begin();` | `01` | 1 | inline | Enters the anim state. |
| `move_begin_reset();` | `02` | 1 | inline | Enters the move state and sets the entity's `ignore_player_flag` to 2 and `action_behavior` and `action_state` to 0. |
| `move_begin();` | `03` | 1 | inline | Enters the move state. |
| `set_entity(kind, i);` | `04 kind:u8 i:u8` | 3 | `scd_event_cmd_set_entity` 0x0041e520 | Sets the entity the anim and move ops drive. `ENT_PLAYER` (0) the player, `ENT_ENEMY` (1) `g_EnemiesList[i]`, `ENT_OBJECT` (2) `g_omodel_table[i]`, `ENT_ITEM` (3) `g_item_model_table[i]`. Any other kind leaves it unchanged. |
| `evt_start(slot, script);` | `05 slot:u8 script:u8 00` | 4 | `scd_event_cmd_create` 0x0041e5d0 | Starts another event, as SCD `evt_exec`. |
| `scd { ... }` | `06 LL size:u16 code 00 00` | LL + 1 | `scd_event_cmd_run_scd` 0x0041e620 | Runs an SCD block through `run_command_functions` (0x00473f60): `size` is the block size word and `code` the SCD opcodes, written in the same pseudo-C as init and main. LL is `size + 3`. The engine reads the next block size from the byte before LL and the byte at LL, so the event byte after the block must be 0; the block owns it. |
| an SCD command, such as `set(FG_ROOM, 3, 0);` | `07 LL cmd` | LL | `scd_event_cmd_exec` 0x0041e650 | Runs one SCD command of LL - 2 bytes, then moves LL bytes. Its return value is ignored. |
| `evt_jump(script);` | `08 script:u8` | 2 | `scd_event_cmd_init` 0x0041e600 | Restarts this slot at another script, in the command state with empty stacks. Yields. |
| `evt_kill(slot);` | `09 slot:u8` | 2 | inline | Deactivates the event in slot 0 to 7. |

### Anim state

All in `scd_event_state1_anim` (0x0041da30). They act on the slot's entity.

| Text | Bytes | Length | What it does |
| --- | --- | --- | --- |
| `anim_nop();` | `00` | 1 | Nothing. |
| `anim_end_release();` | `80` | 1 | Clears the entity's `ignore_player_flag`, then as `anim_end`. |
| `anim_end();` | `8B` | 1 | Back to the command state. |
| `anim_look_at(flags);` | `81 flags:u8` | 2 | Sets `lookAtFlags` when its low 4 bits are 0, such as 0x10. |
| `anim_look_at(flags, a, b, c, yaw, pitch);` | `81 flags:u8 a:s16 b:s16 c:s16 yaw:u8 pitch:u8` | 10 | Sets `lookAtFlags` when its low 4 bits are not 0. With flags 0x93, `a` is a target kind as in `set_entity` and `b` its index. Otherwise `a b c` is a position, wrapped by 0x1000 when bit 0x20 is set. `yaw` and `pitch` are turn steps, 0 for the defaults 0xC0 and 0x40. |
| `anim_look_off();` | `82` | 1 | Clears bit 0x10 of `lookAtFlags`. |
| `anim_pose(behavior, c6, c8, param);` | `83 behavior:u8 c6:u16 c8:u16 param:u8` | 7 | Sets the entity's state to 8 and its `action_behavior`. Bit 0x10 of `behavior` keeps the low 4 bits and gates on `collisionFlags`. Stores `c6`, `c8` and `scd_anim_param`, and sets `scd_timer` to 0x28. |
| `anim_play(anim, param, flags);` | `84 anim:u8 param:u8 flags:u8` | 4 | Sets state 8, behavior 1 and `animationId`. `scd_anim_param` is `param`, and `scd_entity_flags` is `(param + flags * 256) >> 6 & 0x3FC`. |
| `anim_action(behavior, anim, param);` | `85 behavior:u8 anim:u8 param:u8` | 4 | Sets state 8, `action_behavior`, `animationId` and `scd_anim_param`. |
| `anim_idle();` | `86` | 1 | Back to idle: state 1, behavior, action and `hit_state` cleared. |
| `anim_flags(mode, value);` | `87 mode:u8 value:u16` | 4 | Changes `scd_entity_flags`: mode 0 ORs, 1 sets, 2 XORs. |
| `anim_timer(n);` | `88 00 n:u16` | 4 | Sets `scd_timer`. |
| `anim_frame(n);` | `89 n:u8` | 2 | Sets `animation_frame_id` and resets blending. For entities below 0x20 it remaps the animation through `g_ScdAnimRemap` (0x004bec80). |
| `anim_frame_raw(n);` | `8A n:u8` | 2 | As `anim_frame`, without the remap. |

### Move state

All in `scd_event_state2_movement` (0x0041e1a0). They act on the slot's entity.

| Text | Bytes | Length | What it does |
| --- | --- | --- | --- |
| `move_nop();` | `00` | 1 | Nothing. |
| `move_end();` | `01` | 1 | Back to the command state. |
| `move_step();` | `02` | 1 | Adds the speed to the position. |
| `move_turn();` | `03` | 1 | Adds the turn steps to the rotation. |
| `move_step_turn();` | `04` | 1 | Both. |
| `move_speed(x, y, z);` | `05 x:s8 y:s8 z:s8` | 4 | Sets the speed. |
| `move_turn_speed(x, y, z);` | `06 x:s8 y:s8 z:s8` | 4 | Sets the turn steps. `z` lands in the entity's `state` word. |
| `move_pos(x, y, z);` | `07 00 x:s16 y:s16 z:s16` | 8 | Sets the position. |
| `move_byte(offset, value);` | `08 offset:u8 value:u8` | 3 | Stores one byte at entity + 0x84 + offset (0x0041e3b6). |
| `move_hit_state(n);` | `09 n:u8` | 2 | Sets `hit_state`. |
| `move_field(field, value);` | `0A field:u8 value:s16` | 4 | Field 0 to 2 sets the position's x, y or z, 3 `health`, 4 `unk_c6`, 5 `unk_c8` (0x0041e3fa). The original stores through an unset pointer for any other field. |
| `move_rot(x, y, z);` | `0B 00 x:s16 y:s16 z:s16` | 8 | Sets the rotation (0x0041e486). |

A move loop looks like this:

```c
move_begin();
    move_speed(0, 0, -20);
    repeat (15) {
        move_step();
        yield();
    }
move_end();
```

## Text format

`rae script` prints each event script after the init and main procedures, under
`// event procedure N @ 0x...`, where N is the script's index in the table and
the offset is where it starts in the file. Ops between `anim_begin()` and
`anim_end()`, or `move_begin()` and `move_end()`, are indented one more level,
since the engine reads them from another table. `rae asm` ignores the
indentation and the offset.

Statements that are not event ops are SCD commands. Event op names never clash
with SCD names, and the anim and move op names start with `anim_` and `move_`.

The trailing zero bytes that pad a script to 4 bytes are left out of the text.
Other zero bytes print as `evt_nop();`, `anim_nop();` or `move_nop();`.

Three forms keep retail bytes the named forms cannot hold:

- `scd_bytes(0x2A, ...);` is an SCD command whose length byte does not match the
  command. The engine runs the whole command and reads past the length when it
  is short. The comment after it shows the command the engine runs. 111 retail
  `effect` commands give 10 of their 12 bytes, so the engine takes their flags
  word from the next event op.
- `scd_block_bytes(...);` is an SCD block whose `if` lengths do not match its
  blocks, such as an `endif` with no `if`. It holds the block's code; the
  assembler adds the size and the closing zero word.
- `raw(...);` holds the bytes from the first one the engine would stop or hang
  at to the end of the script. When that byte is inside a loop, `raw` starts at
  the outermost open loop. It must be the last statement.

## Assembler rules

`rae asm` refuses text the engine cannot run:

- An op read in a state other than the current one: anim ops outside an
  `anim_begin()` block, move ops outside a `move_begin()` block, and command
  ops, SCD commands and `scd { }` blocks inside either.
- A `repeat` or `do` block that ends in a different state than it began in,
  since its second pass would be read from the wrong table.
- A `do` block with no `yield()`, `sleep()` or `wait_voice()` inside. Without
  one the engine tests the condition again in the same frame for as long as it
  holds.
- Loops nested more than 4 deep, or `sleep` and `wait_voice` inside 4 open
  loops, the size of the slot's stacks.
- `sleep(0)` and `repeat (0)`, which count down from 0 and run 65536 times.
- `anim_look_at` with 1 operand when the low 4 bits of its flags are set, or 6
  when they are clear. The engine reads the length from the flags.
- `evt_kill` with a slot above 7, which writes past `g_ScdEventTable`.
- An empty event procedure, and more than 256 of them.
- Statements after `raw(...)`, `if` blocks outside `scd { }`, and the SCD rules
  for init and main inside `scd { }` blocks and SCD commands.

`rae asm` does not require `return;` at the end, because retail scripts run on
into the next one. It does not check that a script index is in the table:
the init and main scripts of retail rooms 5071, 6031 and 60B1 name event
indexes their tables do not have.

## Writing a room

The writer builds a new events section: the table, a 0 entry, then each script
padded to 4 bytes. Like the init, main and message writers, it puts the section
behind the old data, moves `snd.vb` to the end and points entry 8 of the offset
table at the new section. When the section's bytes are already the room's, the
room is left as it was.

## What retail rooms show

The PC rooms (Stage1 to Stage7, 320 rooms, 1969 event scripts) all round-trip
byte for byte through `rae script` and `rae asm`
(`pnpm verify:evt <dir>`). They contain:

- 8 scripts that end in `raw`. Six reach the end of a short SCD command and
  then a byte with no command-state op (0x17, 0x48 or 0x0A), which deactivates
  the event. ROOM1060 and ROOM6060 event 8 run an SCD command in the anim
  state, where the engine would hang.
- 125 `scd_bytes` commands and 6 `scd_block_bytes` blocks.
- No instruction of 4 bytes or more at an odd offset from its script's start.
  The zero bytes printed as `evt_nop()`, `anim_nop()` and `move_nop()` are what
  keep them even. The PC engine reads unaligned values without trouble. The
  PS1's CPU cannot read a 16-bit value from an odd address, which is the likely
  reason for the layout. The assembler neither adds these nops nor requires
  them; add them by hand for a script that also has to run on a PS1.
