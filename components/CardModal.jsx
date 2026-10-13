import { getDb } from '@/lib/db';
import Markdown from './Markdown';
import { fmtDay, fmtDateTime } from '@/lib/format';
import {
  ModalShell, CardTitle, Description, DueDate, MoveCard, CardActions,
  CommentForm, CommentItem, UploadZone, AttachmentItem,
} from './CardParts';

const initials = (u) => (u?.full_name || u?.username || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('');

export default function CardModal({ boardId, cardId }) {
  const db = getDb();
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(cardId, boardId);
  if (!card) return null;

  const lists = db.prepare('SELECT id, title, archived FROM lists WHERE board_id = ? ORDER BY position').all(boardId);
  const comments = db.prepare(`SELECT c.*, u.username, u.full_name FROM comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.card_id = ? ORDER BY c.created_at DESC`).all(cardId);
  const attachments = db.prepare('SELECT * FROM attachments WHERE card_id = ? ORDER BY created_at').all(cardId);
  const author = card.created_by && db.prepare('SELECT username, full_name FROM users WHERE id = ?').get(card.created_by);
  const listTitle = lists.find((l) => l.id === card.list_id)?.title;

  return (
    <ModalShell boardId={boardId}>
      <CardTitle cardId={card.id} title={card.title} />
      <p className="muted small" style={{ margin: 0 }}>
        in list <strong>{listTitle}</strong>
        {card.archived ? <strong className="error"> · archived</strong> : null}
        {' · '}created {fmtDay(card.created_at)}
        {author ? ` by ${author.full_name || author.username}` : ''}
      </p>

      <div className="modal-grid">
        <div>
          <section>
            <h3>Description</h3>
            <Description cardId={card.id} value={card.description}>
              {card.description.trim() ? <Markdown>{card.description}</Markdown> : null}
            </Description>
          </section>

          <section>
            <h3>Attachments</h3>
            <div className="attachments">
              {attachments.map((a) => <AttachmentItem key={a.id} attachment={a} />)}
            </div>
            <UploadZone cardId={card.id} />
          </section>

          <section>
            <h3>Comments</h3>
            <CommentForm cardId={card.id} />
            {comments.map((c) => (
              <div className="comment" key={c.id}>
                <div className="avatar">{initials(c)}</div>
                <div className="comment-body">
                  <div className="small">
                    <strong>{c.full_name || c.username || 'deleted user'}</strong>{' '}
                    <span className="muted">
                      {fmtDateTime(c.created_at)}
                      {c.updated_at && c.updated_at !== c.created_at ? ' (edited)' : ''}
                    </span>
                  </div>
                  <CommentItem commentId={c.id} text={c.text}>
                    <Markdown>{c.text}</Markdown>
                  </CommentItem>
                </div>
              </div>
            ))}
          </section>
        </div>

        <aside className="modal-side">
          <div className="stack">
            <h3>Due date</h3>
            <DueDate cardId={card.id} value={card.due_at} />
            <h3 style={{ marginTop: 16 }}>Move to list</h3>
            <MoveCard cardId={card.id} listId={card.list_id} lists={lists} />
            <h3 style={{ marginTop: 16 }}>Actions</h3>
            <CardActions cardId={card.id} boardId={boardId} archived={!!card.archived} />
          </div>
        </aside>
      </div>
    </ModalShell>
  );
}
