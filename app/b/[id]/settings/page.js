import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireBoard } from '@/lib/auth';
import {
  updateBoardAction, setBoardArchivedAction, deleteBoardAction, addMemberAction, removeMemberAction,
} from '../../../actions';

export default async function BoardSettings({ params }) {
  const { id } = await params;
  await requireBoard(id);
  const db = getDb();
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  const members = db.prepare(`SELECT u.id, u.username, u.full_name FROM board_members m JOIN users u ON u.id = m.user_id
    WHERE m.board_id = ? ORDER BY u.username`).all(id);
  const others = db.prepare(`SELECT username FROM users WHERE disabled = 0 AND id NOT IN
    (SELECT user_id FROM board_members WHERE board_id = ?) ORDER BY username`).all(id);

  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <p><Link href={board.archived ? '/' : `/b/${id}`}>← Back</Link></p>
      <h1>Board settings</h1>

      <div className="panel stack">
        <h2>Title</h2>
        <form action={updateBoardAction} className="row">
          <input type="hidden" name="id" value={id} />
          <input name="title" defaultValue={board.title} required style={{ flex: 1, width: 'auto' }} />
          <button className="primary">Save</button>
        </form>
      </div>

      <div className="panel stack" style={{ marginTop: 16 }}>
        <h2>Members</h2>
        <p className="muted small">Members can see and edit everything on this board. Admins can see every board.</p>
        <table className="simple">
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.full_name || m.username} <span className="muted">@{m.username}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <form action={removeMemberAction}>
                    <input type="hidden" name="board_id" value={id} />
                    <input type="hidden" name="user_id" value={m.id} />
                    <button className="danger">Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {others.length > 0 && (
          <form action={addMemberAction} className="row">
            <input type="hidden" name="board_id" value={id} />
            <select name="username" style={{ flex: 1, width: 'auto' }}>
              {others.map((u) => <option key={u.username}>{u.username}</option>)}
            </select>
            <button>Add member</button>
          </form>
        )}
      </div>

      <div className="panel stack" style={{ marginTop: 16 }}>
        <h2>{board.archived ? 'Archived' : 'Archive'}</h2>
        <form action={setBoardArchivedAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="archived" value={board.archived ? '0' : '1'} />
          <button>{board.archived ? 'Restore board' : 'Archive board'}</button>
        </form>
        <form action={deleteBoardAction} className="row">
          <input type="hidden" name="id" value={id} />
          <input name="confirm" placeholder='Type "delete" to confirm' style={{ flex: 1, width: 'auto' }} />
          <button className="danger">Delete forever</button>
        </form>
      </div>
    </main>
  );
}
