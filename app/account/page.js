import { requireUser } from '@/lib/auth';
import ActionForm from '@/components/ActionForm';
import { changePasswordAction } from '../actions';

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <main className="page" style={{ maxWidth: 420 }}>
      <h1>{user.full_name || user.username}</h1>
      <p className="muted">@{user.username}{user.email ? ` · ${user.email}` : ''}</p>
      <div className="panel">
        <h2>Change password</h2>
        <ActionForm action={changePasswordAction} submit="Change password">
          <input name="current" type="password" placeholder="Current password" autoComplete="current-password" required />
          <input name="next" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" required />
        </ActionForm>
      </div>
    </main>
  );
}
