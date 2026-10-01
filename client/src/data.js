import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export function useResource(path) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const reload = useCallback((options) => {
    if (!path) return undefined;
    const silent = options?.silent === true;
    let live = true;
    if (!silent) setState((current) => ({ ...current, loading: true, error: '' }));
    api.get(path)
      .then((data) => { if (live) setState({ loading: false, error: '', data }); })
      .catch((error) => {
        if (!live) return;
        setState((current) => (silent && current.data ? { ...current, loading: false } : { loading: false, error: error.message, data: null }));
      });
    return () => { live = false; };
  }, [path]);

  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}
