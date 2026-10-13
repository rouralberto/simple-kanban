import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import ActionForm from '@/components/ActionForm';
import { loginAction, setupAction } from '../actions';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  const firstRun = getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

  return (
    <main className="auth panel">
      <h1>▦ Simple Kanban</h1>
      {firstRun ? (
        <>
          <p className="muted">No users yet. Create the first admin account.</p>
          <ActionForm action={setupAction} submit="Create admin">
            <input name="username" placeholder="Username" autoComplete="username" required />
            <input name="full_name" placeholder="Full name (optional)" />
            <input name="email" type="email" placeholder="Email (optional)" />
            <input name="password" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" required />
          </ActionForm>
        </>
      ) : (
        <ActionForm action={loginAction} submit="Log in">
          <input name="username" placeholder="Username or email" autoComplete="username" required autoFocus />
          <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        </ActionForm>
      )}
    </main>
  );
}
