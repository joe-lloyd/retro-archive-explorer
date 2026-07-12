import { useState } from 'react';
import { FolderOpen, HardDrive } from 'lucide-react';
import type { VirtualNode } from '../shared/types';
import { useArchive } from './hooks/useIPC';
import { Sidebar } from './components/Sidebar';
import { ViewerContainer } from './components/ViewerContainer';

export function App() {
  const { root, opening, error, open } = useArchive();
  const [selected, setSelected] = useState<VirtualNode | null>(null);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <HardDrive size={18} /> Retro Archive Explorer
        </span>
        <button className="open-btn" onClick={open} disabled={opening}>
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
