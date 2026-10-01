import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export function useResource(path) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const reload = useCallback(() => {
    if (!path) return undefined;
    let live = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api.get(path)
      .then((data) => { if (live) setState({ loading: false, error: '', data }); })
      .catch((error) => { if (live) setState({ loading: false, error: error.message, data: null }); });
    return () => { live = false; };
  }, [path]);

  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}
