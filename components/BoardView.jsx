'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createCardAction, createListAction, moveCardAction, renameListAction,
  reorderListsAction, setListArchivedAction,
} from '@/app/actions';
import { fmtDay } from '@/lib/format';

const isOverdue = (due) => due && new Date(due) < new Date(new Date().toDateString());

export default function BoardView({ boardId, lists: initial }) {
  const router = useRouter();
  const [lists, setLists] = useState(initial);
  const [, startTransition] = useTransition();
  const drag = useRef(null); // { type: 'card', id, fromList } | { type: 'list', id }
  const [cardDrop, setCardDrop] = useState(null); // { listId, index }
  const [listDrop, setListDrop] = useState(null); // index

  // Server data wins whenever it changes (after an action revalidates).
  useEffect(() => setLists(initial), [initial]);

  const openCard = (id) => router.push(`/b/${boardId}?card=${id}`, { scroll: false });

  // ---- card drag & drop
  function cardIndexAt(listEl, clientY) {
    const cards = [...listEl.querySelectorAll('[data-card-id]')].filter((el) => el.dataset.cardId !== drag.current?.id);
    const i = cards.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  }

  function onListDragOver(e, listId, listIndex) {
    if (!drag.current) return;
    e.preventDefault();
    if (drag.current.type === 'card') {
      const index = cardIndexAt(e.currentTarget, e.clientY);
      if (cardDrop?.listId !== listId || cardDrop?.index !== index) setCardDrop({ listId, index });
    } else {
      const r = e.currentTarget.getBoundingClientRect();
      const index = e.clientX < r.left + r.width / 2 ? listIndex : listIndex + 1;
      if (listDrop !== index) setListDrop(index);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const d = drag.current;
    if (d?.type === 'card' && cardDrop) {
      const card = lists.flatMap((l) => l.cards).find((c) => c.id === d.id);
      const next = lists.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== d.id) }));
      const target = next.find((l) => l.id === cardDrop.listId);
      target.cards.splice(cardDrop.index, 0, card);
      setLists(next);
      startTransition(() => moveCardAction(d.id, target.id, target.cards.map((c) => c.id)));
    } else if (d?.type === 'list' && listDrop !== null) {
      const from = lists.findIndex((l) => l.id === d.id);
      const next = [...lists];
      const [moved] = next.splice(from, 1);
      next.splice(listDrop > from ? listDrop - 1 : listDrop, 0, moved);
      setLists(next);
      startTransition(() => reorderListsAction(boardId, next.map((l) => l.id)));
    }
    endDrag();
  }

  function endDrag() {
    drag.current = null;
    setCardDrop(null);
    setListDrop(null);
    document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  }

  return (
    <div className="board-lists" onDragEnd={endDrag}>
      {lists.map((list, li) => (
        <div key={list.id} style={{ display: 'contents' }}>
          {listDrop === li && <div className="drop-marker" style={{ width: 3, height: 'auto', alignSelf: 'stretch' }} />}
          <section
            className="list"
            onDragOver={(e) => onListDragOver(e, list.id, li)}
            onDrop={onDrop}
          >
            <ListHeader
              list={list}
              onDragStart={(e) => {
                drag.current = { type: 'list', id: list.id };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', list.title);
                e.currentTarget.closest('.list').classList.add('dragging');
              }}
            />
            <div className="list-cards">
              {list.cards.map((card, ci) => (
                <div key={card.id} style={{ display: 'contents' }}>
                  {cardDrop?.listId === list.id && cardDrop.index === ci && <div className="drop-marker" />}
                  <CardTile
                    card={card}
                    onOpen={() => openCard(card.id)}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      drag.current = { type: 'card', id: card.id };
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', card.title);
                      e.currentTarget.classList.add('dragging');
                    }}
                  />
                </div>
              ))}
              {cardDrop?.listId === list.id && cardDrop.index >= list.cards.filter((c) => c.id !== drag.current?.id).length && (
                <div className="drop-marker" />
              )}
            </div>
            <AddCard listId={list.id} />
          </section>
        </div>
      ))}
      {listDrop === lists.length && <div className="drop-marker" style={{ width: 3, height: 'auto', alignSelf: 'stretch' }} />}
      <AddList boardId={boardId} />
    </div>
  );
}

function CardTile({ card, onOpen, onDragStart }) {
  return (
    <div
      className="card"
      data-card-id={card.id}
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      role="button"
      tabIndex={0}
    >
      {card.title}
      {(card.hasDescription || card.comments || card.attachments || card.due_at || card.checklist) ? (
        <div className="badges">
          {card.due_at && <span className={isOverdue(card.due_at) ? 'overdue' : ''} title="Due date">🗓 {fmtDay(card.due_at)}</span>}
          {card.hasDescription && <span title="Has description">≡</span>}
          {card.checklist && <span title="Checklist">☑ {card.checklist.done}/{card.checklist.total}</span>}
          {card.comments > 0 && <span title="Comments">💬 {card.comments}</span>}
          {card.attachments > 0 && <span title="Attachments">📎 {card.attachments}</span>}
        </div>
      ) : null}
    </div>
  );
}

function ListHeader({ list, onDragStart }) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);

  function save(e) {
    const title = e.target.value.trim();
    setEditing(false);
    if (title && title !== list.title) renameListAction(list.id, title);
  }

  return (
    <div className="list-head" draggable={!editing} onDragStart={onDragStart}>
      {editing ? (
        <input
          defaultValue={list.title}
          autoFocus
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="title" onClick={() => setEditing(true)}>{list.title}</span>
      )}
      <span className="list-count">{list.cards.length}</span>
      <div className="menu">
        <button className="ghost" onClick={() => setMenu(!menu)} aria-label="List menu">⋯</button>
        {menu && (
          <div className="menu-items" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => { setMenu(false); setEditing(true); }}>Rename list</button>
            <button onClick={() => { setMenu(false); setListArchivedAction(list.id, true); }}>Archive list</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddCard({ listId }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e) {
    e?.preventDefault();
    if (!title.trim()) return;
    const t = title;
    setTitle('');
    startTransition(() => createCardAction(listId, t));
  }

  if (!open) {
    return <div className="add-card"><button className="ghost" onClick={() => setOpen(true)}>+ Add a card</button></div>;
  }
  return (
    <form className="add-card stack" onSubmit={submit}>
      <textarea
        autoFocus
        value={title}
        placeholder="Card title…"
        style={{ minHeight: 56 }}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) submit(e);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="row">
        <button className="primary" disabled={pending}>Add card</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>✕</button>
      </div>
    </form>
  );
}

function AddList({ boardId }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <div className="add-list"><button className="ghost" onClick={() => setOpen(true)}>+ Add a list</button></div>;
  }
  return (
    <form className="add-list stack" action={async (fd) => { await createListAction(fd); }}>
      <input type="hidden" name="board_id" value={boardId} />
      <input name="title" placeholder="List title…" autoFocus required onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <div className="row">
        <button className="primary">Add list</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>✕</button>
      </div>
    </form>
  );
}
