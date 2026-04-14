import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authenticatedFetch } from './api';
import { isSupabaseAuthConfigured, supabase } from './supabaseClient';

const defaultState = {
  loaded: false,
  isAdmin: false,
  export: true,
  ai: true,
  launchnotes: true,
  notifications: true
};

const PermissionsContext = createContext({ ...defaultState, refresh: async () => {} });

export function PermissionsProvider({ children }) {
  const [state, setState] = useState(defaultState);

  const refresh = useCallback(async () => {
    if (!isSupabaseAuthConfigured() || !supabase) {
      setState({ ...defaultState, loaded: true });
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState({ ...defaultState, loaded: true });
      return;
    }
    try {
      const res = await authenticatedFetch('/api/me/permissions');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ ...defaultState, loaded: true });
        return;
      }
      setState({
        loaded: true,
        isAdmin: !!data.isAdmin,
        export: data.export !== false,
        ai: data.ai !== false,
        launchnotes: data.launchnotes !== false,
        notifications: data.notifications !== false
      });
    } catch {
      setState({ ...defaultState, loaded: true });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isSupabaseAuthConfigured() || !supabase) return undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  const value = { ...state, refresh };
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
