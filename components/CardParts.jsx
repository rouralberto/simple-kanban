'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateCardAction, moveCardAction, setCardArchivedAction, deleteCardAction,
  addCommentAction, editCommentAction, deleteCommentAction, deleteAttachmentAction,
} from '@/app/actions';
import { fmtDay } from '@/lib/format';

export function ModalShell({ boardId, children }) {
  const router = useRouter();
  const close = () => router.push(`/b/${boardId}`, { scroll: false });

  useEffect(() => {
    const onKey = (e) => {
      // Text fields handle Escape themselves (cancel edit); everything else closes the modal.
      if (e.key === 'Escape' && !e.target.matches?.('textarea, input[type=text], input:not([type])')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true">
        <button className="modal-close ghost" onClick={close} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}

export function CardTitle({ cardId, title }) {
  return (
    <textarea
      key={title}
      className="card-title-input"
      defaultValue={title}
      rows={1}
      style={{ minHeight: 0, resize: 'none', width: 'calc(100% - 40px)' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      }}
      onBlur={(e) => {
        const v = e.target.value.replace(/\s+/g, ' ').trim();
        if (v && v !== title) updateCardAction(cardId, { title: v });
      }}
    />
  );
}

export function Description({ cardId, value, children }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div
        className={`description-view ${children ? '' : 'empty'}`}
        onClick={(e) => { if (!e.target.closest('a')) { setDraft(value); setEditing(true); } }}
      >
        {children || 'Add a more detailed description… (Markdown supported)'}
      </div>
    );
  }
  const save = () => startTransition(async () => {
    await updateCardAction(cardId, { description: draft });
    setEditing(false);
  });
  return (
    <div className="stack">
      <textarea
        className="description-input"
        autoFocus
        value={draft}
        rows={Math.min(25, Math.max(6, draft.split('\n').length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <div className="row">
        <button className="primary" onClick={save} disabled={pending}>Save</button>
        <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
        <span className="muted small">Markdown · ⌘/Ctrl+Enter to save</span>
      </div>
    </div>
  );
}

export function DueDate({ cardId, value }) {
  return (
    <input
      type="date"
      defaultValue={value ? value.slice(0, 10) : ''}
      onChange={(e) => updateCardAction(cardId, { due_at: e.target.value || null })}
    />
  );
}

export function MoveCard({ cardId, listId, lists }) {
  return (
    <select
      value={listId}
      onChange={(e) => moveCardAction(cardId, e.target.value, [])}
    >
      {lists.map((l) => (
        <option key={l.id} value={l.id}>{l.title}{l.archived ? ' (archived)' : ''}</option>
      ))}
    </select>
  );
}

export function CardActions({ cardId, boardId, archived }) {
  const router = useRouter();
  return (
    <div className="stack">
      <button onClick={() => setCardArchivedAction(cardId, !archived)}>
        {archived ? '↩ Restore' : '🗄 Archive'}
      </button>
      {archived && (
        <button
          className="danger"
          onClick={async () => {
            if (!confirm('Delete this card forever? Comments and attachments go with it.')) return;
            await deleteCardAction(cardId);
            router.push(`/b/${boardId}`, { scroll: false });
          }}
        >
          🗑 Delete forever
        </button>
      )}
    </div>
  );
}

export function CommentForm({ cardId }) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const submit = () => {
    if (!text.trim()) return;
    startTransition(async () => {
      await addCommentAction(cardId, text);
      setText('');
    });
  };
  return (
    <div className="stack">
      <textarea
        value={text}
        placeholder="Write a comment… (Markdown supported)"
        rows={2}
        style={{ minHeight: 0 }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
      />
      {text && <button className="primary" onClick={submit} disabled={pending}>Comment</button>}
    </div>
  );
}

export function CommentItem({ commentId, text, children }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <div className="stack" style={{ marginTop: 4 }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        <div className="row">
          <button
            className="primary"
            disabled={pending}
            onClick={() => startTransition(async () => { await editCommentAction(commentId, draft); setEditing(false); })}
          >
            Save
          </button>
          <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="comment-text">{children}</div>
      <div className="row small">
        <button className="link" onClick={() => { setDraft(text); setEditing(true); }}>Edit</button>
        <button
          className="link"
          onClick={() => confirm('Delete this comment?') && deleteCommentAction(commentId)}
        >
          Delete
        </button>
      </div>
    </>
  );
}

export function UploadZone({ cardId }) {
  const router = useRouter();
  const input = useRef(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('');

  async function upload(files) {
    if (!files?.length) return;
    setStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    const fd = new FormData();
    [...files].forEach((f) => fd.append('file', f));
    const res = await fetch(`/api/cards/${cardId}/attachments`, { method: 'POST', body: fd });
    if (res.ok) {
      setStatus('');
      router.refresh();
    } else {
      setStatus((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
    }
  }

  // Paste screenshots straight into the open card.
  useEffect(() => {
    const onPaste = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) upload(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div
      className={`dropzone ${active ? 'active' : ''}`}
      style={{ marginTop: 8 }}
      onDragOver={(e) => { e.preventDefault(); setActive(true); }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => { e.preventDefault(); setActive(false); upload(e.dataTransfer.files); }}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      {status || (
        <>Drop files here, paste a screenshot, or <button className="link" onClick={() => input.current.click()}>browse</button></>
      )}
    </div>
  );
}

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export function AttachmentItem({ attachment: a }) {
  const isImage = /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mime_type);
  const ext = a.filename.includes('.') ? a.filename.split('.').pop().slice(0, 5) : 'file';
  return (
    <div className="attachment">
      <a className="thumb" href={`/files/${a.id}`} target="_blank" rel="noreferrer">
        {isImage ? <img src={`/files/${a.id}`} alt="" loading="lazy" /> : ext}
      </a>
      <div className="info">
        <a href={`/files/${a.id}`} target="_blank" rel="noreferrer" title={a.filename}>{a.filename}</a>
        <div className="muted small">
          {fmtSize(a.size)} · {fmtDay(a.created_at)} ·{' '}
          <a href={`/files/${a.id}?download`}>Download</a> ·{' '}
          <button className="link small" onClick={() => confirm(`Delete ${a.filename}?`) && deleteAttachmentAction(a.id)}>Delete</button>
        </div>
      </div>
    </div>
  );
}
