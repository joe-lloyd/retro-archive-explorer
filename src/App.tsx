import { useState } from 'react';
import { FolderOpen, Home, HardDrive } from 'lucide-react';
import type { VirtualNode } from '../shared/types';
import { useArchive, useRecents } from './hooks/useIPC';
import { HomeScreen } from './components/HomeScreen';
import { Sidebar } from './components/Sidebar';
import { ViewerContainer } from './components/ViewerContainer';

export function App() {
  const { root, opening, error, open, openPath, close } = useArchive();
  const { recents, refresh, remove, clear } = useRecents();
  const [selected, setSelected] = useState<VirtualNode | null>(null);

  const goHome = async () => {
    await close();
    setSelected(null);
    void refresh();
  };

  // Home screen whenever no archive is mounted.
  if (!root) {
    return (
      <HomeScreen
        recents={recents}
        busy={opening}
        error={error}
        onOpen={async () => {
          await open();
          void refresh();
        }}
        onOpenPath={async (path) => {
          await openPath(path);
          void refresh();
        }}
        onRemove={remove}
        onClear={clear}
      />
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <HardDrive size={18} /> Retro Archive Explorer
        </span>
        <button className="toolbar-btn" onClick={goHome} title="Back to home">
          <Home size={16} /> Home
        </button>
        <button className="toolbar-btn" onClick={open} disabled={opening}>
          <FolderOpen size={16} />
          {opening ? 'Opening…' : 'Open image'}
        </button>
        {error && <span className="toolbar-error">{error}</span>}
      </header>

      <div className="workspace">
        <Sidebar root={root} selectedId={selected?.id ?? null} onSelect={setSelected} />
        <ViewerContainer node={selected} onOpen={setSelected} />
      </div>
    </div>
  );
}
