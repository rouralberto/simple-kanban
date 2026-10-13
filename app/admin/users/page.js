import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import ActionForm from '@/components/ActionForm';
import { createUserAction, resetPasswordAction, toggleUserFlagAction } from '../../actions';

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = getDb().prepare('SELECT * FROM users ORDER BY username').all();

  return (
    <main className="page">
      <h1>Users</h1>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="simple">
          <thead>
            <tr><th>User</th><th>Role</th><th>Reset password</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.username}</strong>{u.disabled ? <span className="error"> (disabled)</span> : null}
                  <div className="muted small">{[u.full_name, u.email].filter(Boolean).join(' · ')}</div>
                </td>
                <td>{u.is_admin ? 'Admin' : 'Member'}</td>
                <td>
                  <form action={resetPasswordAction} className="row">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="password" type="password" placeholder="New password" minLength={8} style={{ width: 150 }} required />
                    <button>Set</button>
                  </form>
                </td>
                <td>
                  {u.id !== me.id && (
                    <div className="row">
                      <form action={toggleUserFlagAction}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="flag" value="is_admin" />
                        <button>{u.is_admin ? 'Make member' : 'Make admin'}</button>
                      </form>
                      <form action={toggleUserFlagAction}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="flag" value="disabled" />
                        <button className={u.disabled ? '' : 'danger'}>{u.disabled ? 'Enable' : 'Disable'}</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 16, maxWidth: 420 }}>
        <h2>Add user</h2>
        <ActionForm action={createUserAction} submit="Create user">
          <input name="username" placeholder="Username" required />
          <input name="full_name" placeholder="Full name (optional)" />
          <input name="email" type="email" placeholder="Email (optional)" />
          <input name="password" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" required />
          <label className="row"><input type="checkbox" name="is_admin" /> Admin</label>
        </ActionForm>
      </div>
    </main>
  );
}
