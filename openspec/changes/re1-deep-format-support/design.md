## Context

The app already mounts RE1 discs and dispatches by extension. The gaps are decode quality (models), decode coverage (audio, engine containers), and presentation defaults (preview vs hex). RE1 uses standard PSX TMD primitives and SPU-ADPCM audio, both well-documented, so the model and audio work is bounded. The engine containers (RDT/DAT/camera/…) are game-specific and only partially documented publicly, so those are interpreted best-effort and clearly labeled.

## Goals / Non-Goals

**Goals:**
- Correct, colored TMD/EMD geometry; best-effort EMD texturing.
- Playable PSX audio (VAG/SPU-ADPCM → WAV).
- Identify every RE1 extension and give a structured "what this is" preview.
- Tabbed Preview/Hex/Text viewer, Preview default.

**Non-Goals:**
- Cycle-accurate PSX VRAM/GPU emulation; full XA streaming decode; animation/skeleton playback; editing/repacking.

## Decisions

**Self-consistency TMD packet decode.** The unknown per-primitive is whether normals are present. The decoder computes the preamble word count (from TME/IIP) and compares `preamble + geomWithNormals` vs `preamble + geomWithoutNormals` against the packet's declared `ilen` to pick the layout, then reads vertices from the correct positions. This avoids hardcoding all ~16 permutations and is unit-testable with synthetic packets. Alternative: a full permutation table — rejected as error-prone to transcribe and harder to verify.

**Non-indexed, expanded geometry with vertex colors.** Flat/gouraud face colors on shared indexed vertices bleed between faces. Expanding each triangle into 3 unique vertices lets each face carry its own color and gives the correct retro look, at the cost of a larger buffer (acceptable for RE1-scale meshes). The renderer uses `vertexColors` with modest ambient light.

**Best-effort EMD texturing.** Scan the EMD for an embedded TIM; if found, decode it to RGBA, emit UVs from textured primitives, and build a `THREE.DataTexture` + `MeshBasicMaterial`. If absent/unresolvable, fall back to gray. This is speculative (texture pairing varies) but degrades cleanly.

**Audio decode in main, output WAV.** SPU/VAG ADPCM (4-bit, 28 samples/block, 2 filter bytes) decodes to PCM16 with a small filter-coefficient table; wrap as a WAV so the existing `<audio>` element and Web Audio waveform both work unchanged. XA is detected and reported, not decoded.

**RE1 registry.** A single `re1/formats.ts` maps extension → `{ name, description, decoder }`. Containers (RDT/DAT) reuse the offset-table unpacker but with named slots; camera/STF get dedicated interpreters; everything else returns a structured identification summary. Keeps “identify vs decode” separable and honest about confidence.

**Tabbed viewer, lazy hex/text.** `ViewerContainer` owns the active tab (default Preview). Preview consumes the `parseAsset` result; Hex/Text call `readNode` on demand so raw bytes aren't fetched for every selection.

## Risks / Trade-offs

- **RE1 container layouts are partially guessed** → interpret tolerantly, label as best-effort, always keep Hex/Text so nothing is hidden.
- **TMD decode edge cases** (unusual primitive modes) → self-consistency check falls back to a documented default and skips primitives it cannot resolve rather than corrupting the mesh.
- **EMD texture pairing may be wrong** → gray fallback keeps geometry usable.
- **Expanded geometry increases memory** → bounded by RE1 model sizes; acceptable.
- **ADPCM sample rate unknown for raw blocks** → default to a documented rate (e.g. from VAG header, else 44100/22050) and note it.

## Open Questions

- Exact RDT header slot count/order for RE1 (vs RE2/3) — start with the documented RE1 layout, refine against real files.
- Whether RE1 EMD textures live inside the EMD, the parent RDT, or a sibling — scan EMD first, extend to parent later.
- XA streaming decode — deferred; detect and label for now.
