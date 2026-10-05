import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearSupportToken, currentToken, restoreSupportToken, setAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onLost = () => setUser(null);
    window.addEventListener('airo:unauthorized', onLost);
    return () => window.removeEventListener('airo:unauthorized', onLost);
  }, []);

  useEffect(() => {
    let live = true;
    async function boot() {
      try {
        if (restoreSupportToken()) {
          try {
            const me = await api.get('/api/auth/me');
            if (live) setUser(me);
            return;
          } catch {
            clearSupportToken();
          }
        }
        const data = await api.post('/api/auth/refresh');
        setAccessToken(data.accessToken);
        const me = await api.get('/api/auth/me');
        if (live) setUser(me);
      } catch {
        if (live) setUser(null);
      } finally {
        if (live) setLoading(false);
      }
    }
    boot();
    return () => { live = false; };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(email, password, remember = true) {
      clearSupportToken();
      const data = await api.post('/api/auth/login', { email, password, remember });
      setAccessToken(data.accessToken);
      setUser({ ...data.user, permissions: data.user.permissions });
      const me = await api.get('/api/auth/me');
      setUser(me);
      return me;
    },
    async logout() {
      const support = user?.supportAccess;
      if (support) {
        const platformToken = sessionStorage.getItem('airo_platform_token');
        clearSupportToken();
        sessionStorage.removeItem('airo_platform_token');
        if (platformToken) {
          setAccessToken(platformToken);
          const me = await api.get('/api/auth/me');
          setUser(me);
          return 'platform';
        }
      }
      await api.post('/api/auth/logout').catch(() => null);
      setAccessToken(null);
      setUser(null);
      return 'login';
    },
    async enterSupport(organizationId) {
      sessionStorage.setItem('airo_platform_token', currentToken() || '');
      const data = await api.post(`/api/admin/organizations/${organizationId}/support-access`);
      setAccessToken(data.accessToken, true);
      const me = await api.get('/api/auth/me');
      setUser(me);
      return me;
    },
    can(permission) {
      return Boolean(user?.permissions?.includes(permission));
    }
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
