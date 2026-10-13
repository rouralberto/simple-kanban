'use server';

import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, newId, now, UPLOADS_DIR } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/passwords';
import {
  login, logout, requireUser, requireAdmin, requireBoard, requireCard,
} from '@/lib/auth';

const str = (fd, key) => String(fd.get(key) ?? '').trim();
const boardPath = (id) => `/b/${id}`;

function nextPosition(table, column, value) {
  const row = getDb().prepare(`SELECT MAX(position) AS p FROM ${table} WHERE ${column} = ?`).get(value);
  return (row?.p ?? -1) + 1;
}

// ---------------------------------------------------------------- auth

export async function loginAction(_prev, fd) {
  const user = await login(str(fd, 'username'), String(fd.get('password') ?? ''));
  if (!user) return { error: 'Wrong username or password.' };
  redirect('/');
}

export async function logoutAction() {
  await logout();
  redirect('/login');
}

// First-run only: creates the initial admin when the users table is empty.
export async function setupAction(_prev, fd) {
  const db = getDb();
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return { error: 'Already set up.' };
  const username = str(fd, 'username');
  const password = String(fd.get('password') ?? '');
  if (!username || password.length < 8) return { error: 'Username required, password at least 8 characters.' };
  db.prepare('INSERT INTO users (id, username, email, full_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, 1)')
    .run(newId(), username, str(fd, 'email') || null, str(fd, 'full_name') || null, hashPassword(password));
  await login(username, password);
  redirect('/');
}

export async function changePasswordAction(_prev, fd) {
  const user = await requireUser();
  const row = getDb().prepare('SELECT password_hash, password_algo FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(fd.get('current') ?? ''), row.password_hash, row.password_algo)) {
    return { error: 'Current password is wrong.' };
  }
  const next = String(fd.get('next') ?? '');
  if (next.length < 8) return { error: 'New password must be at least 8 characters.' };
  getDb().prepare("UPDATE users SET password_hash = ?, password_algo = 'bcrypt' WHERE id = ?").run(hashPassword(next), user.id);
  return { ok: 'Password changed.' };
}

// ---------------------------------------------------------------- admin

export async function createUserAction(_prev, fd) {
  await requireAdmin();
  const username = str(fd, 'username');
  const password = String(fd.get('password') ?? '');
  if (!username || password.length < 8) return { error: 'Username required, password at least 8 characters.' };
  try {
    getDb().prepare('INSERT INTO users (id, username, email, full_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), username, str(fd, 'email') || null, str(fd, 'full_name') || null, hashPassword(password), fd.get('is_admin') ? 1 : 0);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { error: `User "${username}" already exists.` };
    throw e;
  }
  revalidatePath('/admin/users');
  return { ok: `Created ${username}.` };
}

export async function resetPasswordAction(fd) {
  await requireAdmin();
  const password = String(fd.get('password') ?? '');
  if (password.length < 8) return;
  const db = getDb();
  db.prepare("UPDATE users SET password_hash = ?, password_algo = 'bcrypt' WHERE id = ?").run(hashPassword(password), str(fd, 'id'));
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(str(fd, 'id'));
  revalidatePath('/admin/users');
}

export async function toggleUserFlagAction(fd) {
  const me = await requireAdmin();
  const id = str(fd, 'id');
  const flag = str(fd, 'flag');
  if (!['is_admin', 'disabled'].includes(flag) || id === me.id) return;
  getDb().prepare(`UPDATE users SET ${flag} = 1 - ${flag} WHERE id = ?`).run(id);
  if (flag === 'disabled') getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  revalidatePath('/admin/users');
}

// ---------------------------------------------------------------- boards

export async function createBoardAction(fd) {
  const user = await requireUser();
  const title = str(fd, 'title');
  if (!title) return;
  const db = getDb();
  const id = newId();
  db.transaction(() => {
    db.prepare('INSERT INTO boards (id, title, position, created_by) VALUES (?, ?, ?, ?)')
      .run(id, title, (db.prepare('SELECT MAX(position) AS p FROM boards').get().p ?? -1) + 1, user.id);
    db.prepare('INSERT INTO board_members (board_id, user_id) VALUES (?, ?)').run(id, user.id);
    ['To do', 'Doing', 'Done'].forEach((t, i) =>
      db.prepare('INSERT INTO lists (id, board_id, title, position) VALUES (?, ?, ?, ?)').run(newId(), id, t, i));
  })();
  redirect(boardPath(id));
}

export async function updateBoardAction(fd) {
  const id = str(fd, 'id');
  await requireBoard(id);
  const title = str(fd, 'title');
  if (title) getDb().prepare('UPDATE boards SET title = ? WHERE id = ?').run(title, id);
  revalidatePath(boardPath(id), 'layout');
}

export async function setBoardArchivedAction(fd) {
  const id = str(fd, 'id');
  await requireBoard(id);
  getDb().prepare('UPDATE boards SET archived = ? WHERE id = ?').run(fd.get('archived') === '1' ? 1 : 0, id);
  revalidatePath('/');
  redirect('/');
}

export async function deleteBoardAction(fd) {
  const id = str(fd, 'id');
  await requireBoard(id);
  if (str(fd, 'confirm') !== 'delete') return;
  const db = getDb();
  const files = db.prepare('SELECT a.storage_path FROM attachments a JOIN cards c ON c.id = a.card_id WHERE c.board_id = ?').all(id);
  db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  files.forEach((f) => removeUpload(f.storage_path));
  revalidatePath('/');
  redirect('/');
}

export async function addMemberAction(fd) {
  const boardId = str(fd, 'board_id');
  await requireBoard(boardId);
  const user = getDb().prepare('SELECT id FROM users WHERE username = ?').get(str(fd, 'username'));
  if (user) getDb().prepare('INSERT OR IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)').run(boardId, user.id);
  revalidatePath(`${boardPath(boardId)}/settings`);
}

export async function removeMemberAction(fd) {
  const boardId = str(fd, 'board_id');
  await requireBoard(boardId);
  getDb().prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, str(fd, 'user_id'));
  revalidatePath(`${boardPath(boardId)}/settings`);
}

// ---------------------------------------------------------------- lists

export async function createListAction(fd) {
  const boardId = str(fd, 'board_id');
  await requireBoard(boardId);
  const title = str(fd, 'title');
  if (!title) return;
  getDb().prepare('INSERT INTO lists (id, board_id, title, position) VALUES (?, ?, ?, ?)')
    .run(newId(), boardId, title, nextPosition('lists', 'board_id', boardId));
  revalidatePath(boardPath(boardId));
}

export async function renameListAction(listId, title) {
  const list = getDb().prepare('SELECT board_id FROM lists WHERE id = ?').get(listId);
  if (!list || !title?.trim()) return;
  await requireBoard(list.board_id);
  getDb().prepare('UPDATE lists SET title = ? WHERE id = ?').run(title.trim(), listId);
  revalidatePath(boardPath(list.board_id));
}

export async function setListArchivedAction(listId, archived) {
  const list = getDb().prepare('SELECT board_id FROM lists WHERE id = ?').get(listId);
  if (!list) return;
  await requireBoard(list.board_id);
  getDb().prepare('UPDATE lists SET archived = ? WHERE id = ?').run(archived ? 1 : 0, listId);
  revalidatePath(boardPath(list.board_id));
}

export async function deleteListAction(listId) {
  const list = getDb().prepare('SELECT board_id FROM lists WHERE id = ?').get(listId);
  if (!list) return;
  await requireBoard(list.board_id);
  const db = getDb();
  const files = db.prepare('SELECT a.storage_path FROM attachments a JOIN cards c ON c.id = a.card_id WHERE c.list_id = ?').all(listId);
  db.prepare('DELETE FROM lists WHERE id = ?').run(listId);
  files.forEach((f) => removeUpload(f.storage_path));
  revalidatePath(boardPath(list.board_id));
}

export async function reorderListsAction(boardId, orderedIds) {
  await requireBoard(boardId);
  const db = getDb();
  const stmt = db.prepare('UPDATE lists SET position = ? WHERE id = ? AND board_id = ?');
  db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, id, boardId)))();
  revalidatePath(boardPath(boardId));
}

// ---------------------------------------------------------------- cards

export async function createCardAction(listId, title) {
  const list = getDb().prepare('SELECT board_id FROM lists WHERE id = ?').get(listId);
  if (!list || !title?.trim()) return;
  const user = await requireBoard(list.board_id);
  const id = newId();
  getDb().prepare('INSERT INTO cards (id, board_id, list_id, title, position, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, list.board_id, listId, title.trim(), nextPosition('cards', 'list_id', listId), user.id);
  revalidatePath(boardPath(list.board_id));
  return id;
}

// Moves a card into listId and rewrites that list's order to orderedIds.
// Without orderedIds the card goes to the bottom of the list.
export async function moveCardAction(cardId, listId, orderedIds = []) {
  const { card } = await requireCard(cardId);
  const db = getDb();
  const list = db.prepare('SELECT board_id FROM lists WHERE id = ?').get(listId);
  if (!list || list.board_id !== card.board_id) return;
  const stmt = db.prepare('UPDATE cards SET position = ? WHERE id = ? AND list_id = ?');
  db.transaction(() => {
    const position = orderedIds.length ? card.position : nextPosition('cards', 'list_id', listId);
    db.prepare('UPDATE cards SET list_id = ?, position = ?, updated_at = ? WHERE id = ?').run(listId, position, now(), cardId);
    orderedIds.forEach((id, i) => stmt.run(i, id, listId));
  })();
  revalidatePath(boardPath(card.board_id));
}

export async function updateCardAction(cardId, fields) {
  const { card } = await requireCard(cardId);
  const next = {
    title: typeof fields.title === 'string' && fields.title.trim() ? fields.title.trim() : card.title,
    description: typeof fields.description === 'string' ? fields.description : card.description,
    due_at: 'due_at' in fields ? (fields.due_at || null) : card.due_at,
  };
  getDb().prepare('UPDATE cards SET title = ?, description = ?, due_at = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.description, next.due_at, now(), cardId);
  revalidatePath(boardPath(card.board_id));
}

export async function setCardArchivedAction(cardId, archived) {
  const { card } = await requireCard(cardId);
  const db = getDb();
  db.prepare('UPDATE cards SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now(), cardId);
  // Restoring a card into an archived list would leave it invisible; restore the list too.
  if (!archived) db.prepare('UPDATE lists SET archived = 0 WHERE id = ?').run(card.list_id);
  revalidatePath(boardPath(card.board_id));
}

export async function deleteCardAction(cardId) {
  const { card } = await requireCard(cardId);
  const db = getDb();
  const files = db.prepare('SELECT storage_path FROM attachments WHERE card_id = ?').all(cardId);
  db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
  files.forEach((f) => removeUpload(f.storage_path));
  revalidatePath(boardPath(card.board_id));
}

// ---------------------------------------------------------------- comments

export async function addCommentAction(cardId, text) {
  const { user, card } = await requireCard(cardId);
  if (!text?.trim()) return;
  getDb().prepare('INSERT INTO comments (id, card_id, user_id, text) VALUES (?, ?, ?, ?)').run(newId(), cardId, user.id, text.trim());
  revalidatePath(boardPath(card.board_id));
}

async function ownComment(commentId) {
  const c = getDb().prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!c) return null;
  const { user, card } = await requireCard(c.card_id);
  if (c.user_id !== user.id && !user.is_admin) return null;
  return { comment: c, card };
}

export async function editCommentAction(commentId, text) {
  const found = await ownComment(commentId);
  if (!found || !text?.trim()) return;
  getDb().prepare('UPDATE comments SET text = ?, updated_at = ? WHERE id = ?').run(text.trim(), now(), commentId);
  revalidatePath(boardPath(found.card.board_id));
}

export async function deleteCommentAction(commentId) {
  const found = await ownComment(commentId);
  if (!found) return;
  getDb().prepare('DELETE FROM comments WHERE id = ?').run(commentId);
  revalidatePath(boardPath(found.card.board_id));
}

// ---------------------------------------------------------------- attachments

function removeUpload(storagePath) {
  const full = path.join(UPLOADS_DIR, storagePath);
  if (full.startsWith(UPLOADS_DIR + path.sep)) fs.rmSync(full, { force: true });
}

export async function deleteAttachmentAction(attachmentId) {
  const a = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
  if (!a) return;
  const { card } = await requireCard(a.card_id);
  getDb().prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
  removeUpload(a.storage_path);
  revalidatePath(boardPath(card.board_id));
}
