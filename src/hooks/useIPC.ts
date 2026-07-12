import { useCallback, useEffect, useState } from 'react';
import type { ParsedAsset, Result, VirtualNode } from '../../shared/types';

/** Unwrap a Result, throwing the error string so callers can catch uniformly. */
function unwrap<T>(res: Result<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Mount/open the archive and expose the resulting tree root. */
export function useArchive() {
  const [state, setState] = useState<AsyncState<VirtualNode>>({
    data: null,
    loading: false,
    error: null,
  });

  const open = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const root = unwrap(await window.retro.openArchive());
      setState({ data: root, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: (err as Error).message });
    }
  }, []);

  return { root: state.data, opening: state.loading, error: state.error, open };
}

/** Parse the selected node into a viewer-ready asset, tracking loading/error. */
export function useAsset(node: VirtualNode | null) {
  const [state, setState] = useState<AsyncState<ParsedAsset>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!node || node.type !== 'file') {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    window.retro
      .parseAsset({ nodeId: node.id })
      .then((res) => {
        if (cancelled) return;
        setState({ data: unwrap(res), loading: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [node]);

  return { asset: state.data, loading: state.loading, error: state.error };
}

/** Fetch a node's raw bytes, lazily (only when `enabled`). */
export function useRawBytes(node: VirtualNode | null, enabled: boolean) {
  const [state, setState] = useState<AsyncState<Uint8Array>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!node || node.type !== 'file' || !enabled) return;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    window.retro
      .readNode({ nodeId: node.id })
      .then((res) => {
        if (cancelled) return;
        setState({ data: unwrap(res), loading: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [node, enabled]);

  return { bytes: state.data, loading: state.loading, error: state.error };
}
