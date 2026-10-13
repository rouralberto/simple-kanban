import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getDb, now } from './db';
import { verifyPassword, hashPassword } from './passwords';

const COOKIE = 'sk_session';
const SESSION_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function login(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || user.disabled || !verifyPassword(password, user.password_hash, user.password_algo)) return null;

  if (user.password_algo !== 'bcrypt') {
    db.prepare("UPDATE users SET password_hash = ?, password_algo = 'bcrypt' WHERE id = ?")
      .run(hashPassword(password), user.id);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), user.id, expires.toISOString());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    expires,
  });
  return user;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  jar.delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return getDb().prepare(`
    SELECT u.id, u.username, u.email, u.full_name, u.is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
  `).get(sha256(token), now()) || null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.is_admin) notFound();
  return user;
}

export function canAccessBoard(user, boardId) {
  if (!user) return false;
  if (user.is_admin) return !!getDb().prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId);
  return !!getDb().prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, user.id);
}

export async function requireBoard(boardId) {
  const user = await requireUser();
  if (!canAccessBoard(user, boardId)) notFound();
  return user;
}

// Resolve the board a card belongs to and check access in one go.
export async function requireCard(cardId) {
  const card = getDb().prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) notFound();
  const user = await requireBoard(card.board_id);
  return { user, card };
}
