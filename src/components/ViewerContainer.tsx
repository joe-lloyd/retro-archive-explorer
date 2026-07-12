import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ParsedAsset, VirtualNode } from '../../shared/types';
import { useAsset, useRawBytes } from '../hooks/useIPC';
import { TextureViewer } from './viewers/TextureViewer';
import { ModelViewer } from './viewers/ModelViewer';
import { AudioViewer } from './viewers/AudioViewer';
import { ArchiveViewer } from './viewers/ArchiveViewer';
import { StructuredViewer } from './viewers/StructuredViewer';
import { RawView } from './viewers/RawView';

type Tab = 'preview' | 'hex' | 'text';

interface Props {
  node: VirtualNode | null;
  onOpen?: (node: VirtualNode) => void;
}

function Preview({
  asset,
  onOpen,
}: {
  asset: ParsedAsset;
  onOpen?: (node: VirtualNode) => void;
}) {
  switch (asset.kind) {
    case 'texture':
      return <TextureViewer asset={asset} />;
    case 'model':
      return <ModelViewer asset={asset} />;
    case 'audio':
      return <AudioViewer asset={asset} />;
    case 'archive':
      return <ArchiveViewer asset={asset} onOpen={onOpen} />;
    case 'structured':
      return <StructuredViewer asset={asset} />;
    case 'text':
      // Truly unknown: the best "interpretation" we have is a hex dump.
      return <RawView bytes={asset.bytes} mode="hex" />;
  }
}

function PreviewTab({ node, onOpen }: Props) {
  const { asset, loading, error } = useAsset(node);
  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 className="spin" size={20} /> Parsing {node?.name}…
      </div>
    );
  }
  if (error) return <div className="viewer-state error">Could not parse {node?.name}: {error}</div>;
  if (!asset) return <div className="viewer-state">No preview available.</div>;
  return <Preview asset={asset} onOpen={onOpen} />;
}

function RawTab({ node, mode }: { node: VirtualNode; mode: 'hex' | 'text' }) {
  const { bytes, loading, error } = useRawBytes(node, true);
  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 className="spin" size={20} /> Loading bytes…
      </div>
    );
  }
  if (error) return <div className="viewer-state error">{error}</div>;
  if (!bytes) return <div className="viewer-state">No data.</div>;
  return <RawView bytes={bytes} mode={mode} />;
}

export function ViewerContainer({ node, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('preview');

  // Reset to the interpreted preview whenever a new file is selected.
  useEffect(() => {
    setTab('preview');
  }, [node?.id]);

  if (!node) {
    return <main className="viewer"><div className="viewer-state">Select a file to preview it.</div></main>;
  }

  return (
    <main className="viewer">
      <div className="viewer-header">
        <span className="viewer-title">{node.path}</span>
        <div className="viewer-tabs">
          {(['preview', 'hex', 'text'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`viewer-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'preview' ? 'Preview' : t === 'hex' ? 'Hex' : 'Text'}
            </button>
          ))}
        </div>
      </div>
      <div className="viewer-body">
        {tab === 'preview' && <PreviewTab node={node} onOpen={onOpen} />}
        {tab === 'hex' && <RawTab node={node} mode="hex" />}
        {tab === 'text' && <RawTab node={node} mode="text" />}
      </div>
    </main>
  );
}
