import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireBoard } from '@/lib/auth';
import BoardView from '@/components/BoardView';
import CardModal from '@/components/CardModal';
import ArchivePanel from '@/components/ArchivePanel';

function checklistProgress(description) {
  const done = (description.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
  const open = (description.match(/^\s*[-*] \[ \]/gm) || []).length;
  return done + open ? { done, total: done + open } : null;
}

export default async function BoardPage({ params, searchParams }) {
  const { id } = await params;
  const { card: cardId, archive } = await searchParams;
  await requireBoard(id);

  const db = getDb();
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!board) notFound();

  const lists = db.prepare('SELECT id, title FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position, created_at').all(id);
  const cards = db.prepare(`
    SELECT c.id, c.list_id, c.title, c.description, c.due_at,
      (SELECT COUNT(*) FROM comments x WHERE x.card_id = c.id) AS comments,
      (SELECT COUNT(*) FROM attachments x WHERE x.card_id = c.id) AS attachments
    FROM cards c WHERE c.board_id = ? AND c.archived = 0
    ORDER BY c.position, c.created_at
  `).all(id);

  const byList = new Map(lists.map((l) => [l.id, { ...l, cards: [] }]));
  for (const c of cards) {
    byList.get(c.list_id)?.cards.push({
      id: c.id,
      title: c.title,
      hasDescription: !!c.description.trim(),
      checklist: checklistProgress(c.description),
      due_at: c.due_at,
      comments: c.comments,
      attachments: c.attachments,
    });
  }

  const archivedCount = db.prepare(`SELECT
    (SELECT COUNT(*) FROM cards WHERE board_id = ? AND archived = 1) +
    (SELECT COUNT(*) FROM lists WHERE board_id = ? AND archived = 1) AS n`).get(id, id).n;

  return (
    <>
      <div className="board-header">
        <h1>{board.title}</h1>
        {board.archived ? <span className="muted">(archived)</span> : null}
        <span className="spacer" />
        <Link className="btn" href={archive ? `/b/${id}` : `/b/${id}?archive=1`} scroll={false}>
          Archive ({archivedCount})
        </Link>
        <Link className="btn" href={`/b/${id}/settings`}>Settings</Link>
      </div>
      <div className="board-scroll">
        <BoardView boardId={id} lists={[...byList.values()]} />
      </div>
      {archive && <ArchivePanel boardId={id} />}
      {cardId && <CardModal boardId={id} cardId={cardId} />}
    </>
  );
}
