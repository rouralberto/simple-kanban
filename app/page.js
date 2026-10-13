import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { createBoardAction } from './actions';

export default async function Home() {
  const user = await requireUser();
  const boards = getDb().prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id AND c.archived = 0) AS open_cards
    FROM boards b
    WHERE ? OR b.id IN (SELECT board_id FROM board_members WHERE user_id = ?)
    ORDER BY b.position, b.created_at
  `).all(user.is_admin ? 1 : 0, user.id);

  const active = boards.filter((b) => !b.archived);
  const archived = boards.filter((b) => b.archived);

  return (
    <main className="page">
      <h1>Boards</h1>
      <div className="board-grid">
        {active.map((b) => (
          <Link key={b.id} href={`/b/${b.id}`} className="board-tile">
            {b.title}
            <small>{b.open_cards} open card{b.open_cards === 1 ? '' : 's'}</small>
          </Link>
        ))}
        <form action={createBoardAction} className="panel stack">
          <input name="title" placeholder="New board title" required />
          <button className="primary">Create board</button>
        </form>
      </div>

      {archived.length > 0 && (
        <>
          <h2 className="muted">Archived boards</h2>
          <div className="board-grid">
            {archived.map((b) => (
              <Link key={b.id} href={`/b/${b.id}/settings`} className="board-tile archived">{b.title}</Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
