#!/usr/bin/env node
// Create a user or reset an existing user's password.
//   node scripts/create-user.mjs <username> <password> [--admin] [--email x] [--name "Full Name"]
import { openDb, newId } from '../lib/db.js';
import { hashPassword } from '../lib/passwords.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const isAdmin = args.includes('--admin') ? (args.splice(args.indexOf('--admin'), 1), 1) : 0;
const email = flag('--email');
const fullName = flag('--name');
const [username, password] = args;

if (!username || !password || password.length < 8) {
  console.error('usage: create-user <username> <password (8+ chars)> [--admin] [--email x] [--name "Full Name"]');
  process.exit(1);
}

const db = openDb();
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, password_algo = 'bcrypt', is_admin = MAX(is_admin, ?) WHERE id = ?")
    .run(hashPassword(password), isAdmin, existing.id);
  console.log(`Updated password for ${username}`);
} else {
  db.prepare('INSERT INTO users (id, username, email, full_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), username, email ?? null, fullName ?? null, hashPassword(password), isAdmin);
  console.log(`Created ${isAdmin ? 'admin' : 'user'} ${username}`);
}
