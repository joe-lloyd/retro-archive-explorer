// Structural types shared across the main and renderer processes.
// Everything here must be structured-cloneable so it can cross the IPC boundary.

/** A node in the mounted virtual file tree. */
export interface VirtualNode {
  id: string;
  name: string;
  path: string;
  type: 'directory' | 'file';
  extension?: string;
  size: number;
  /** Absolute byte offset within the mounted image, or relative offset inside a container. */
  offset?: number;
  children?: VirtualNode[];
}

/** High-level asset category the renderer uses to pick a viewer. */
export type AssetKind = 'texture' | 'model' | 'audio' | 'archive' | 'text';

/** Decoded `.TIM` texture, ready for a Canvas 2D blit. */
export interface TextureAsset {
  kind: 'texture';
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, length === width * height * 4. */
  pixels: Uint8ClampedArray;
  bitDepth: 4 | 8 | 16 | 24;
}

/** A single mesh object extracted from a `.TMD`/`.EMD` file. */
export interface MeshObject {
  name: string;
  /**
   * Non-indexed, expanded triangle positions: 3 vertices (9 floats) per triangle.
   * Faces are expanded so each can carry its own flat/gouraud color without bleed.
   */
  positions: Float32Array;
  /** Per-vertex RGB in 0..1, matching `positions` (3 floats per vertex), if colored. */
  colors?: Float32Array;
  /** Per-vertex UVs in 0..1, matching `positions` (2 floats per vertex), if textured. */
  uvs?: Float32Array;
  /** Triangle count (positions.length / 9). */
  triangleCount: number;
}

/** Optional texture image applied to a model's UV-mapped meshes. */
export interface ModelTexture {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  pixels: Uint8ClampedArray;
}

/** Decoded model containing one or more objects. */
export interface ModelAsset {
  kind: 'model';
  objects: MeshObject[];
  /** Shared texture (from an embedded/adjacent TIM), when resolved. */
  texture?: ModelTexture;
}

/** One field in a structured interpretation. */
export interface StructuredField {
  label: string;
  value: string;
}

/** A named group of fields (e.g. an RDT section or a camera record). */
export interface StructuredSection {
  title: string;
  fields: StructuredField[];
}

/** A best-effort structured interpretation of an engine file. */
export interface StructuredAsset {
  kind: 'structured';
  /** Proper format name, e.g. "Room Data Table (RDT)". */
  format: string;
  /** One-line description of what the file is. */
  summary: string;
  sections: StructuredSection[];
  /** Optional decoded text body (e.g. for .STF). */
  text?: string;
}

/** An unpacked container listing its sub-files as virtual nodes. */
export interface ArchiveAsset {
  kind: 'archive';
  entries: VirtualNode[];
  /** Proper format name for the container, when identified. */
  format?: string;
}

/** Raw bytes for the text/hex fallback viewer. */
export interface TextAsset {
  kind: 'text';
  bytes: Uint8Array;
}

/** Audio payload the renderer plays via an <audio> element / Web Audio. */
export interface AudioAsset {
  kind: 'audio';
  bytes: Uint8Array;
  mime: string;
  /** Human-readable note, e.g. detected source codec or an undecodable warning. */
  note?: string;
}

export type ParsedAsset =
  | TextureAsset
  | ModelAsset
  | ArchiveAsset
  | TextAsset
  | AudioAsset
  | StructuredAsset;

/** A previously opened disc image, shown on the home screen. */
export interface RecentFile {
  /** Absolute path to the image on disk. */
  path: string;
  /** Base file name for display. */
  name: string;
  /** Epoch milliseconds when the file was last opened. */
  lastOpened: number;
}

/** Discriminated result wrapper so parse errors travel as data, never thrown across IPC. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
