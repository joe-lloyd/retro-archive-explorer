import { Clock, FolderOpen, HardDrive, Trash2, X } from 'lucide-react';
import type { RecentFile } from '../../shared/types';

interface Props {
  recents: RecentFile[];
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
}

function relativeTime(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function HomeScreen({
  recents,
  busy,
  error,
  onOpen,
  onOpenPath,
  onRemove,
  onClear,
}: Props) {
  return (
    <div className="home">
      <div className="home-hero">
        <HardDrive className="home-logo" size={44} />
        <h1 className="home-title">Retro Archive Explorer</h1>
        <p className="home-tag">Browse and preview assets inside retro disc images.</p>
        <button className="home-open" onClick={onOpen} disabled={busy}>
          <FolderOpen size={18} />
          {busy ? 'Opening…' : 'Open image'}
        </button>
        {error && <div className="home-error">{error}</div>}
      </div>

      <div className="home-recents">
        <div className="home-recents-head">
          <span>
            <Clock size={14} /> Recent files
          </span>
          {recents.length > 0 && (
            <button className="home-clear" onClick={onClear}>
              <Trash2 size={13} /> Clear all
            </button>
          )}
        </div>

        {recents.length === 0 ? (
          <div className="home-empty">No recent files yet — open an image to get started.</div>
        ) : (
          <ul className="recent-list">
            {recents.map((f) => (
              <li key={f.path} className="recent-item">
                <button className="recent-open" onClick={() => onOpenPath(f.path)} disabled={busy}>
                  <HardDrive size={16} className="recent-icon" />
                  <span className="recent-text">
                    <span className="recent-name">{f.name}</span>
                    <span className="recent-path">{f.path}</span>
                  </span>
                  <span className="recent-time">{relativeTime(f.lastOpened)}</span>
                </button>
                <button
                  className="recent-remove"
                  title="Remove from list"
                  onClick={() => onRemove(f.path)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
