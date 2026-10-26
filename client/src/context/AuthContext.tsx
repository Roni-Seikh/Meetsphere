import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  displayName: string;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the user is signed in immediately, false when email confirmation is required. */
  signUp(name: string, email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  updateDisplayName(name: string): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function nameFrom(user: User | null): string {
  const meta = user?.user_metadata as { display_name?: string } | undefined;
  return meta?.display_name?.trim() || user?.email?.split('@')[0] || 'Guest';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } });
    if (error) throw new Error(error.message);
    return !!data.session;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setOverride(null);
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const res = await api.updateMe(name); // updates the profiles table through the server
    await supabase.auth.updateUser({ data: { display_name: res.displayName } });
    setOverride(res.displayName);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      displayName: override ?? nameFrom(session?.user ?? null),
      loading,
      signIn,
      signUp,
      signOut,
      updateDisplayName,
    }),
    [session, loading, override, signIn, signUp, signOut, updateDisplayName],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
