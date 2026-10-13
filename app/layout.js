import Link from 'next/link';
import './globals.css';
import { currentUser } from '@/lib/auth';
import { logoutAction } from './actions';

export const metadata = { title: 'Simple Kanban' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        {user && (
          <header className="topbar">
            <Link href="/" className="brand">▦ Simple Kanban</Link>
            <nav>
              {user.is_admin ? <Link href="/admin/users">Users</Link> : null}
              <Link href="/account">{user.full_name || user.username}</Link>
              <form action={logoutAction}><button className="link">Log out</button></form>
            </nav>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
