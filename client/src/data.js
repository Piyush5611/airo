import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const cache = new Map();
const CACHE_LIMIT = 60;

export function clearResourceCache() {
  cache.clear();
}

function remember(path, data) {
  cache.delete(path);
  cache.set(path, data);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function initial(path) {
  return path && cache.has(path)
    ? { loading: false, error: '', data: cache.get(path) }
    : { loading: true, error: '', data: null };
}

export function useResource(path) {
  const [state, setState] = useState(() => initial(path));
  const reload = useCallback((options) => {
    if (!path) return undefined;
    const cached = cache.has(path);
    const silent = options?.silent === true || cached;
    let live = true;
    if (cached) setState((current) => (current.data === cache.get(path) ? current : initial(path)));
    else if (!silent) setState((current) => ({ ...current, loading: true, error: '' }));
    api.get(path)
      .then((data) => {
        remember(path, data);
        if (live) setState({ loading: false, error: '', data });
      })
      .catch((error) => {
        if (!live) return;
        setState((current) => (silent && current.data ? { ...current, loading: false } : { loading: false, error: error.message, data: null }));
      });
    return () => { live = false; };
  }, [path]);

  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}
