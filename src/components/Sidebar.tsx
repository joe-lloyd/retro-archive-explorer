import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const CONTAINER_EXT = new Set(['rdt', 'dat', 'vab']);

function isContainer(node: VirtualNode): boolean {
  return node.type === 'file' && !!node.extension && CONTAINER_EXT.has(node.extension);
}

interface Row {
  node: VirtualNode;
  depth: number;
  parentId: string | null;
  expandable: boolean;
}

export function Sidebar({ root, selectedId, onSelect }: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, VirtualNode[]>>(new Map());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(selectedId);
  const listRef = useRef<HTMLDivElement>(null);

  // Follow externally-driven selection (e.g. opening a sub-file from the archive viewer).
  useEffect(() => {
    if (selectedId) setCursorId(selectedId);
  }, [selectedId]);

  const childrenOf = useCallback(
    (node: VirtualNode): VirtualNode[] => {
      if (node.type === 'directory') return node.children ?? [];
      if (isContainer(node)) return childrenCache.get(node.id) ?? node.children ?? [];
      return [];
    },
    [childrenCache],
  );

  const isExpandable = (node: VirtualNode) => node.type === 'directory' || isContainer(node);

  // Flatten the currently-visible tree (respecting expansion) into an ordered list.
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (nodes: VirtualNode[], depth: number, parentId: string | null) => {
      for (const node of nodes) {
        out.push({ node, depth, parentId, expandable: isExpandable(node) });
        if (expanded.has(node.id)) walk(childrenOf(node), depth + 1, node.id);
      }
    };
    if (root) walk(root.children ?? [], 0, null);
    return out;
  }, [root, expanded, childrenOf]);

  const rowIndex = useMemo(
    () => new Map(rows.map((r, i) => [r.node.id, i])),
    [rows],
  );

  const expand = useCallback(
    async (node: VirtualNode) => {
      // Lazily unpack a container the first time it is expanded.
      if (isContainer(node) && !childrenCache.has(node.id)) {
        setLoadingId(node.id);
        const res = await window.retro.parseAsset({ nodeId: node.id });
        setLoadingId(null);
        if (res.ok && res.value.kind === 'archive') {
          setChildrenCache((m) => new Map(m).set(node.id, res.value.kind === 'archive' ? res.value.entries : []));
        }
      }
      setExpanded((s) => new Set(s).add(node.id));
    },
    [childrenCache],
  );

  const collapse = useCallback((id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  // Landing the cursor on a file opens it (selection follows the keyboard).
  const focusRow = useCallback(
    (node: VirtualNode) => {
      setCursorId(node.id);
      if (node.type === 'file') onSelect(node);
    },
    [onSelect],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const idx = cursorId != null ? rowIndex.get(cursorId) ?? -1 : -1;
    const current = idx >= 0 ? rows[idx] : undefined;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(rows[Math.min(rows.length - 1, idx + 1)].node);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(rows[Math.max(0, idx - 1)].node);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (!current) break;
        if (current.expandable && !expanded.has(current.node.id)) {
          void expand(current.node);
        } else if (current.expandable && idx + 1 < rows.length) {
          focusRow(rows[idx + 1].node); // step into first child
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (!current) break;
        if (current.expandable && expanded.has(current.node.id)) {
          collapse(current.node.id);
        } else if (current.parentId) {
          const p = rows.find((r) => r.node.id === current.parentId);
          if (p) focusRow(p.node);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (current?.node.type === 'file') onSelect(current.node);
        break;
    }
  };

  // Keep the cursor row scrolled into view.
  useEffect(() => {
    if (!cursorId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-node-id="${cursorId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursorId, rows]);

  const onRowClick = (row: Row) => {
    setCursorId(row.node.id);
    if (row.node.type === 'file') onSelect(row.node);
    if (row.expandable) {
      if (expanded.has(row.node.id)) collapse(row.node.id);
      else void expand(row.node);
    }
  };

  if (!root) {
    return <aside className="sidebar"><div className="sidebar-empty">Open a disc image to browse its contents.</div></aside>;
  }

  return (
    <aside
      className="sidebar"
      ref={listRef}
      tabIndex={0}
      role="tree"
      aria-label="Disc file tree"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const open = expanded.has(row.node.id);
        const Chevron = open ? ChevronDown : ChevronRight;
        const Icon =
          row.node.type === 'directory' ? Folder : isContainer(row.node) ? Package : FileIcon;
        const active = cursorId === row.node.id || selectedId === row.node.id;
        return (
          <div
            key={row.node.id}
            data-node-id={row.node.id}
            role="treeitem"
            aria-expanded={row.expandable ? open : undefined}
            className={`tree-row${active ? ' selected' : ''}`}
            style={{ paddingLeft: row.depth * 14 + 6 }}
            onClick={() => onRowClick(row)}
          >
            {row.expandable ? (
              <Chevron size={14} className="chevron" />
            ) : (
              <span className="chevron-spacer" />
            )}
            <Icon size={14} className="node-icon" />
            <span className="node-name">{row.node.name}</span>
            {loadingId === row.node.id && <span className="node-size">…</span>}
            {row.node.type === 'file' && loadingId !== row.node.id && (
              <span className="node-size">{row.node.size}</span>
            )}
          </div>
        );
      })}
    </aside>
  );
}
