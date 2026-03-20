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
const MIN_PASSWORD_LEN = 8;

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [mode, setMode] = useState('magic'); // 'magic' | 'password' | 'signup'
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

  const signInWithPassword = useCallback(
    async (e) => {
      e.preventDefault();
      setError(null);
      setMessage(null);
      if (!isAllowedToastEmail(email)) {
        setError(`Use your ${DOMAIN_SUFFIX} work email.`);
        return;
      }
      setBusy(true);
      try {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (err) throw err;
      } catch (err) {
        setError(err.message || 'Sign-in failed.');
      } finally {
        setBusy(false);
      }
    },
    [email, password]
  );

  const signUpWithPassword = useCallback(
    async (e) => {
      e.preventDefault();
      setError(null);
      setMessage(null);
      if (!isAllowedToastEmail(email)) {
        setError(`Use your ${DOMAIN_SUFFIX} work email.`);
        return;
      }
      if (password.length < MIN_PASSWORD_LEN) {
        setError(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
        return;
      }
      if (password !== passwordConfirm) {
        setError('Passwords do not match.');
        return;
      }
      setBusy(true);
      try {
        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo }
        });
        if (err) throw err;
        if (!data.session) {
          setMessage(
            'Account created. Check your email to confirm your address, then use Password to sign in.'
          );
        }
        setPassword('');
        setPasswordConfirm('');
      } catch (err) {
        setError(err.message || 'Sign up failed.');
      } finally {
        setBusy(false);
      }
    },
    [email, password, passwordConfirm]
  );

  const clearAuthFeedback = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);

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

          <div className="auth-gate-tabs auth-gate-tabs-three">
            <button
              type="button"
              className={mode === 'magic' ? 'active' : ''}
              onClick={() => { setMode('magic'); clearAuthFeedback(); }}
            >
              Magic link
            </button>
            <button
              type="button"
              className={mode === 'password' ? 'active' : ''}
              onClick={() => { setMode('password'); clearAuthFeedback(); }}
            >
              Password
            </button>
            <button
              type="button"
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => { setMode('signup'); clearAuthFeedback(); }}
            >
              Sign up
            </button>
          </div>

          {mode === 'magic' ? (
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
          ) : mode === 'password' ? (
            <form onSubmit={signInWithPassword} className="auth-gate-form">
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
              <label className="auth-gate-label">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  required
                  className="auth-gate-input"
                />
              </label>
              <button type="submit" className="btn btn-primary auth-gate-submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={signUpWithPassword} className="auth-gate-form">
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
              <label className="auth-gate-label">
                Password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  required
                  minLength={MIN_PASSWORD_LEN}
                  className="auth-gate-input"
                />
              </label>
              <label className="auth-gate-label">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(ev) => setPasswordConfirm(ev.target.value)}
                  required
                  minLength={MIN_PASSWORD_LEN}
                  className="auth-gate-input"
                />
              </label>
              <p className="auth-gate-hint">At least {MIN_PASSWORD_LEN} characters. Must match Supabase minimum in your project settings.</p>
              <button type="submit" className="btn btn-primary auth-gate-submit" disabled={busy}>
                {busy ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}

          {message && <p className="auth-gate-message success">{message}</p>}
          {error && <p className="auth-gate-message error">{error}</p>}
        </div>
      </div>
    );
  }

  return children;
}
