import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  Package,
} from 'lucide-react';
import type { VirtualNode } from '../../shared/types';

interface SidebarProps {
  root: VirtualNode | null;
  selectedId: string | null;
  onSelect: (node: VirtualNode) => void;
}

const CONTAINER_EXT = new Set(['rdt', 'dat']);

function isContainer(node: VirtualNode): boolean {
  return node.type === 'file' && !!node.extension && CONTAINER_EXT.has(node.extension);
}

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: VirtualNode;
  depth: number;
  selectedId: string | null;
  onSelect: (n: VirtualNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<VirtualNode[] | undefined>(node.children);
  const [loading, setLoading] = useState(false);

  const container = isContainer(node);
  const expandable = node.type === 'directory' || container;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // Lazily unpack a container the first time it is expanded.
    if (next && container && !children) {
      setLoading(true);
      const res = await window.retro.parseAsset({ nodeId: node.id });
      setLoading(false);
      if (res.ok && res.value.kind === 'archive') {
        setChildren(res.value.entries);
      }
    }
  };

  const onRowClick = () => {
    if (node.type === 'file') onSelect(node);
    if (expandable) void toggle();
  };

  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = node.type === 'directory' ? Folder : container ? Package : FileIcon;

  return (
    <div className="tree-node">
      <div
        className={`tree-row${selectedId === node.id ? ' selected' : ''}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={onRowClick}
      >
        {expandable ? <Chevron size={14} className="chevron" /> : <span className="chevron-spacer" />}
        <Icon size={14} className="node-icon" />
        <span className="node-name">{node.name}</span>
        {node.type === 'file' && <span className="node-size">{node.size}</span>}
      </div>
      {open && (
        <div className="tree-children">
          {loading && <div className="tree-loading">unpacking…</div>}
          {children?.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ root, selectedId, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      {!root ? (
        <div className="sidebar-empty">Open a disc image to browse its contents.</div>
      ) : (
        (root.children ?? []).map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </aside>
  );
}
