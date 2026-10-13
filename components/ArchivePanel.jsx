import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ModalShell } from './CardParts';
import { fmtDay } from '@/lib/format';
import { setCardArchivedAction, setListArchivedAction, deleteListAction } from '@/app/actions';

export default function ArchivePanel({ boardId }) {
  const db = getDb();
  const lists = db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM cards c WHERE c.list_id = l.id) AS cards
    FROM lists l WHERE board_id = ? AND archived = 1 ORDER BY position`).all(boardId);
  const cards = db.prepare(`SELECT c.id, c.title, c.updated_at, l.title AS list_title FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE c.board_id = ? AND c.archived = 1 ORDER BY c.updated_at DESC`).all(boardId);

  return (
    <ModalShell boardId={boardId}>
      <h1>Archive</h1>

      <section>
        <h2>Lists ({lists.length})</h2>
        <table className="simple">
          <tbody>
            {lists.map((l) => (
              <tr key={l.id}>
                <td>{l.title} <span className="muted small">· {l.cards} cards</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <form action={setListArchivedAction.bind(null, l.id, false)}><button>Restore</button></form>
                    {l.cards === 0 && (
                      <form action={deleteListAction.bind(null, l.id)}><button className="danger">Delete</button></form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Cards ({cards.length})</h2>
        <table className="simple">
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/b/${boardId}?card=${c.id}`} scroll={false}>{c.title}</Link>
                  <div className="muted small">{c.list_title} · {fmtDay(c.updated_at)}</div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <form action={setCardArchivedAction.bind(null, c.id, false)}><button>Restore</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </ModalShell>
  );
}
