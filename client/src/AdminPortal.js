import React, { useEffect, useState, useCallback } from 'react';
import { authenticatedFetch } from './api';
import { usePermissions } from './permissionsContext';
import './App.css';

export default function AdminPortal({ onExit }) {
  const { isAdmin, refresh: refreshPermissions } = usePermissions();
  const [catalog, setCatalog] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);
  const [busyUserId, setBusyUserId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, usersRes] = await Promise.all([
        authenticatedFetch('/api/admin/permission-catalog'),
        authenticatedFetch('/api/admin/users')
      ]);
      const catData = await catRes.json().catch(() => ({}));
      const usersData = await usersRes.json().catch(() => ({}));
      if (catRes.status === 503 || usersRes.status === 503) {
        setError(
          usersData.details ||
            catData.details ||
            'Admin API needs SUPABASE_SERVICE_ROLE_KEY on the server (never put this in the client).'
        );
        setUsers([]);
        setCatalog([]);
        return;
      }
      if (!catRes.ok) throw new Error(catData.error || catData.details || 'Failed to load catalog');
      if (!usersRes.ok) throw new Error(usersData.error || usersData.details || 'Failed to load users');
      setCatalog(catData.permissions || []);
      setUsers(usersData.users || []);
    } catch (e) {
      setError(e.message || String(e));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  const sendInvite = async (e) => {
    e.preventDefault();
    setInviteMsg(null);
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    try {
      const res = await authenticatedFetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.details || data.error || 'Invite failed');
      setInviteMsg({ type: 'ok', text: `Invitation sent to ${email}` });
      setInviteEmail('');
      await load();
    } catch (err) {
      setInviteMsg({ type: 'err', text: err.message || String(err) });
    } finally {
      setInviteBusy(false);
    }
  };

  const toggleAdmin = async (userId, makeAdmin) => {
    setBusyUserId(userId);
    try {
      if (makeAdmin) {
        const res = await authenticatedFetch('/api/admin/admins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.details || data.error);
      } else {
        const res = await authenticatedFetch(`/api/admin/admins/${encodeURIComponent(userId)}`, {
          method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.details || data.error);
      }
      await load();
      await refreshPermissions();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyUserId(null);
    }
  };

  const setPermission = async (userId, permissionKey, allowed) => {
    setBusyUserId(`${userId}-${permissionKey}`);
    try {
      const res = await authenticatedFetch('/api/admin/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, permissionKey, allowed })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.details || data.error);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, permissions: data.permissions || u.permissions } : u))
      );
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyUserId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="admin-portal">
        <div className="admin-portal-card">
          <h1>Admin</h1>
          <p>You don’t have admin access. Ask an admin to add your account to <code>app_admins</code> in Supabase.</p>
          <button type="button" className="btn btn-primary" onClick={onExit}>
            Back to app
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-portal">
      <header className="admin-portal-header">
        <h1>Admin portal</h1>
        <div className="admin-portal-header-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onExit}>
            Back to app
          </button>
        </div>
      </header>

      <div className="admin-portal-body">
        <section className="admin-portal-section">
          <h2>Invite user</h2>
          <p className="admin-portal-hint">
            Sends a Supabase invite email. Domain rules (e.g. @toasttab.com) still apply from your Auth hooks.
          </p>
          <form className="admin-invite-form" onSubmit={sendInvite}>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@toasttab.com"
              className="admin-invite-input"
            />
            <button type="submit" className="btn btn-primary" disabled={inviteBusy}>
              {inviteBusy ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          {inviteMsg && (
            <p className={inviteMsg.type === 'ok' ? 'admin-msg-ok' : 'admin-msg-err'}>{inviteMsg.text}</p>
          )}
        </section>

        {error && <div className="admin-portal-error">{error}</div>}

        <section className="admin-portal-section">
          <h2>Users & permissions</h2>
          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Admin</th>
                    {catalog.map((c) => (
                      <th key={c.key} title={c.label}>
                        {c.key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="admin-td-email">{u.email || u.id}</td>
                      <td>
                        <label className="admin-toggle">
                          <input
                            type="checkbox"
                            checked={u.is_admin}
                            disabled={busyUserId === u.id}
                            onChange={(e) => toggleAdmin(u.id, e.target.checked)}
                          />
                        </label>
                      </td>
                      {catalog.map((c) => (
                        <td key={c.key}>
                          <label className="admin-toggle">
                            <input
                              type="checkbox"
                              checked={!!u.permissions?.[c.key]}
                              disabled={busyUserId === `${u.id}-${c.key}`}
                              onChange={(e) => setPermission(u.id, c.key, e.target.checked)}
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-portal-section admin-portal-footnote">
          <p>
            <strong>First admin:</strong> run{' '}
            <code>
              insert into public.app_admins (user_id) select id from auth.users where email =
              &apos;you@toasttab.com&apos;;
            </code>{' '}
            in the Supabase SQL Editor. Set <code>SUPABASE_SERVICE_ROLE_KEY</code> and optional{' '}
            <code>PUBLIC_APP_URL</code> on the server for invites.
          </p>
        </section>
      </div>
    </div>
  );
}
