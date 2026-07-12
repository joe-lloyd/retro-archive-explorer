import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RecentFile } from '../shared/types';

const MAX_RECENT = 20;

/**
 * Persists the recent-files list as JSON in the app's userData directory.
 * Owned by the main process — the sandboxed renderer never touches disk.
 */
export class RecentFilesStore {
  private readonly file: string;
  private items: RecentFile[] = [];

  constructor() {
    const dir = app.getPath('userData');
    this.file = path.join(dir, 'recent-files.json');
    this.load(dir);
  }

  private load(dir: string): void {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
        if (Array.isArray(parsed)) {
          this.items = parsed.filter(
            (e): e is RecentFile =>
              e && typeof e.path === 'string' && typeof e.name === 'string' && typeof e.lastOpened === 'number',
          );
        }
      }
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8');
    } catch {
      // Persistence is best-effort; ignore write failures.
    }
  }

  /** Return recent files, most-recent first, with entries whose file is gone pruned out. */
  list(): RecentFile[] {
    const present = this.items.filter((e) => existsSync(e.path));
    if (present.length !== this.items.length) {
      this.items = present;
      this.save();
    }
    return [...this.items];
  }

  /** Record an opened file at the top, de-duplicated by path and capped. */
  add(filePath: string): RecentFile[] {
    const entry: RecentFile = {
      path: filePath,
      name: path.basename(filePath),
      lastOpened: Date.now(),
    };
    this.items = [entry, ...this.items.filter((e) => e.path !== filePath)].slice(0, MAX_RECENT);
    this.save();
    return this.list();
  }

  /** Remove a single entry by path. */
  remove(filePath: string): RecentFile[] {
    this.items = this.items.filter((e) => e.path !== filePath);
    this.save();
    return this.list();
  }

  /** Clear the entire list. */
  clear(): RecentFile[] {
    this.items = [];
    this.save();
    return [];
  }
}
