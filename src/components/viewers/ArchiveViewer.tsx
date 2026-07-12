import { FileDigit } from 'lucide-react';
import type { ArchiveAsset, VirtualNode } from '../../../shared/types';

interface Props {
  asset: ArchiveAsset;
  onOpen?: (node: VirtualNode) => void;
}

export function ArchiveViewer({ asset, onOpen }: Props) {
  return (
    <div className="archive-viewer">
      <table className="archive-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Offset</th>
          </tr>
        </thead>
        <tbody>
          {asset.entries.map((entry) => (
            <tr
              key={entry.id}
              className={onOpen ? 'clickable' : ''}
              onClick={() => onOpen?.(entry)}
            >
              <td>
                <FileDigit size={14} className="node-icon" /> {entry.name}
              </td>
              <td>{entry.size}</td>
              <td>0x{(entry.offset ?? 0).toString(16)}</td>
            </tr>
          ))}
          {asset.entries.length === 0 && (
            <tr>
              <td colSpan={3}>No sub-files found in this container.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
