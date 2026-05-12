import React, { useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseAuthConfigured } from './supabaseClient';

const DOMAIN_SUFFIX = '@toasttab.com';

function isAllowedToastEmail(email) {
  const e = (email || '').trim().toLowerCase();
  return e.endsWith(DOMAIN_SUFFIX);
}

/**
 * When Supabase env vars are set, blocks the app until the user has a session.
 * Server must have SUPABASE_JWT_SECRET set for the same deployment.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSupabaseAuthConfigured()) {
      setSession(null);
      return undefined;
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const sendMagicLink = useCallback(async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!isAllowedToastEmail(email)) {
      setError(`Use your ${DOMAIN_SUFFIX} work email.`);
      return;
    }
    setBusy(true);
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo }
      });
      if (err) throw err;
      setMessage('Check your email for the sign-in link.');
    } catch (err) {
      setError(err.message || 'Could not send sign-in email.');
    } finally {
      setBusy(false);
    }
  }, [email]);

  if (!isSupabaseAuthConfigured()) {
    return children;
  }

  if (session === undefined) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <p className="auth-gate-loading">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <h1 className="auth-gate-title">Confluence Release Manager</h1>
          <p className="auth-gate-sub">Sign in with your Toast work email ({DOMAIN_SUFFIX}).</p>

          <form onSubmit={sendMagicLink} className="auth-gate-form">
            <label className="auth-gate-label">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder={`you${DOMAIN_SUFFIX}`}
                required
                className="auth-gate-input"
              />
            </label>
            <button type="submit" className="btn btn-primary auth-gate-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
          </form>

          {message && <p className="auth-gate-message success">{message}</p>}
          {error && <p className="auth-gate-message error">{error}</p>}
        </div>
      </div>
    );
  }

  return children;
}
