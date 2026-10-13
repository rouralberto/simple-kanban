#!/usr/bin/env node
// Import a WeKan MongoDB database into simple-kanban. Read-only on the WeKan side.
//
//   node scripts/import-wekan.mjs --mongo mongodb://127.0.0.1:27017/wekan [options]
//
// Options:
//   --mongo URL            WeKan MongoDB URL incl. database name (default mongodb://127.0.0.1:27017/wekan)
//   --data-dir DIR         simple-kanban data dir (default $DATA_DIR or ./data)
//   --wekan-files DIR      host path of WeKan's WRITABLE_PATH (/data in the container), needed only
//                          for attachments stored on the filesystem instead of GridFS
//   --include-templates    also import WeKan's "Templates" boards (skipped by default)
//   --skip-archived        don't import archived boards, lists and cards
//   --dry-run              read and report, write nothing
//
// Re-running is safe: WeKan ids are kept, rows that already exist are skipped.
//
// What maps where:
//   users          -> users (WeKan passwords keep working; upgraded to plain bcrypt on first login)
//   boards         -> boards (+ active members -> board_members)
//   lists          -> lists (if a board really uses several swimlanes, lists become "List · Swimlane")
//   cards          -> cards (title, description, due date, archived, order)
//   checklists     -> appended to the card description as Markdown task lists
//   labels, other dates, assignees, members, received/start/end -> one "Imported from WeKan" footer line
//   card_comments  -> comments
//   attachments    -> files under <data-dir>/uploads (GridFS, filesystem, and legacy CollectionFS)
//   activities, rules, custom fields, swimlanes themselves -> not imported
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(name);

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 28).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const MONGO_URL = opt('--mongo', process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/wekan');
const WEKAN_FILES = opt('--wekan-files');
const DRY = has('--dry-run');
const INCLUDE_TEMPLATES = has('--include-templates');
const SKIP_ARCHIVED = has('--skip-archived');
if (opt('--data-dir')) process.env.DATA_DIR = path.resolve(opt('--data-dir'));

const { openDb, DB_PATH, UPLOADS_DIR } = await import('../lib/db.js');
let mongodb;
try {
  mongodb = await import('mongodb');
} catch {
  console.error('The "mongodb" package is missing. Run: npm install mongodb');
  process.exit(1);
}
const { MongoClient, GridFSBucket, ObjectId } = mongodb;

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn(`  ! ${msg}`); };
const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : null);
const day = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : null);

// ------------------------------------------------------------------ read WeKan
console.log(`Reading WeKan from ${MONGO_URL.replace(/\/\/[^@]*@/, '//***@')}`);
const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const mdb = client.db();
const names = new Set((await mdb.listCollections().toArray()).map((c) => c.name));
const all = async (name, query = {}) => (names.has(name) ? mdb.collection(name).find(query).toArray() : []);

const wUsers = await all('users');
let wBoards = await all('boards');
const skippedTemplates = wBoards.filter((b) => /template/.test(b.type || '') && !INCLUDE_TEMPLATES);
wBoards = wBoards.filter((b) => !skippedTemplates.includes(b));
if (SKIP_ARCHIVED) wBoards = wBoards.filter((b) => !b.archived);
const boardIds = new Set(wBoards.map((b) => b._id));

const inBoards = { boardId: { $in: [...boardIds] } };
const wSwimlanes = await all('swimlanes', inBoards);
const wLists = await all('lists', inBoards);
const wCards = await all('cards', inBoards);
const cardIds = wCards.map((c) => c._id);
const wComments = await all('card_comments', { cardId: { $in: cardIds } });
const wChecklists = await all('checklists', { cardId: { $in: cardIds } });
const wChecklistItems = await all('checklistItems', { cardId: { $in: cardIds } });
const wAttachments = await all('attachments', { 'meta.cardId': { $in: cardIds } });
const wCfsAttachments = await all('cfs.attachments.filerecord', { cardId: { $in: cardIds } });

console.log(`Found ${wUsers.length} users, ${wBoards.length} boards` +
  (skippedTemplates.length ? ` (+${skippedTemplates.length} template boards skipped)` : '') +
  `, ${wLists.length} lists, ${wCards.length} cards, ${wComments.length} comments, ` +
  `${wChecklists.length} checklists, ${wAttachments.length + wCfsAttachments.length} attachments`);

// ------------------------------------------------------------------ transform
const db = DRY ? null : openDb();
const existingUserByName = new Map(
  (db ? db.prepare('SELECT id, username FROM users').all() : []).map((u) => [u.username.toLowerCase(), u.id]),
);
const userIdMap = new Map(); // wekan user id -> simple-kanban user id
const users = [];
for (const u of wUsers) {
  const username = u.username || u.emails?.[0]?.address || u._id;
  const existing = existingUserByName.get(username.toLowerCase());
  if (existing && existing !== u._id) {
    userIdMap.set(u._id, existing);
    warn(`user "${username}" already exists in simple-kanban; WeKan data for them is attached to the existing account`);
    continue;
  }
  userIdMap.set(u._id, u._id);
  const bcryptHash = u.services?.password?.bcrypt;
  if (!bcryptHash) warn(`user "${username}" has no WeKan password (OAuth/LDAP?); set one in Users or with npm run create-user`);
  users.push({
    id: u._id,
    username,
    email: u.emails?.[0]?.address || null,
    full_name: u.profile?.fullname || null,
    password_hash: bcryptHash || null,
    password_algo: 'meteor',
    is_admin: u.isAdmin ? 1 : 0,
    disabled: u.loginDisabled ? 1 : 0,
    created_at: iso(u.createdAt) || new Date().toISOString(),
  });
}
const uid = (id) => (id && userIdMap.get(id)) || null;
const usernameOf = new Map(wUsers.map((u) => [u._id, u.username]));

const boards = wBoards.map((b, i) => ({
  id: b._id,
  title: b.title || 'Untitled board',
  position: Number.isFinite(b.sort) ? b.sort : i,
  archived: b.archived ? 1 : 0,
  created_by: uid(b.members?.find((m) => m.isAdmin)?.userId),
  created_at: iso(b.createdAt) || new Date().toISOString(),
}));
const members = wBoards.flatMap((b) => (b.members || [])
  .filter((m) => m.isActive !== false && uid(m.userId))
  .map((m) => ({ board_id: b._id, user_id: uid(m.userId) })));

// Lists. Newer WeKan attaches lists to swimlanes, but cards still point at a listId; we
// flatten swimlanes away unless a board has cards spread across several of them.
const swimlaneTitle = new Map(wSwimlanes.map((s) => [s._id, s.title]));
const listById = new Map(wLists.map((l) => [l._id, l]));
const lists = [];
const listKey = new Map(); // `${listId}|${swimlaneId}` -> new list id
const cardsByBoard = Map.groupBy(wCards, (c) => c.boardId);
for (const b of wBoards) {
  const bCards = cardsByBoard.get(b._id) || [];
  const usedSwimlanes = new Set(bCards.map((c) => c.swimlaneId).filter((s) => swimlaneTitle.has(s)));
  const split = usedSwimlanes.size > 1;
  if (split) warn(`board "${b.title}" uses ${usedSwimlanes.size} swimlanes; lists are split as "List · Swimlane"`);

  const bLists = wLists.filter((l) => l.boardId === b._id).sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
  const swimOrder = [...usedSwimlanes].sort((x, y) =>
    (wSwimlanes.find((s) => s._id === x)?.sort ?? 0) - (wSwimlanes.find((s) => s._id === y)?.sort ?? 0));
  let pos = 0;
  for (const sw of split ? swimOrder : [null]) {
    for (const l of bLists) {
      const hasCards = bCards.some((c) => c.listId === l._id && (!sw || c.swimlaneId === sw));
      if (split && !hasCards) continue;
      const id = sw ? `${l._id}-${sw}` : l._id;
      listKey.set(`${l._id}|${sw ?? ''}`, id);
      lists.push({
        id,
        board_id: b._id,
        title: sw ? `${l.title} · ${swimlaneTitle.get(sw)}` : (l.title || 'Untitled list'),
        position: pos++,
        archived: l.archived ? 1 : 0,
        created_at: iso(l.createdAt) || new Date().toISOString(),
      });
    }
  }
  b._split = split;
  b._nextPos = pos;
}

const checklistsByCard = Map.groupBy(wChecklists, (c) => c.cardId);
const itemsByChecklist = Map.groupBy(wChecklistItems, (i) => i.checklistId);
const cardTitle = new Map(wCards.map((c) => [c._id, c.title]));
const boardById = new Map(wBoards.map((b) => [b._id, b]));
const orphanLists = new Map(); // boardId -> list id for cards whose list vanished

const cards = [];
for (const c of wCards) {
  if (c.type === 'cardType-linkedCard' || c.type === 'cardType-linkedBoard') {
    warn(`skipped linked card "${c.title}"`);
    continue;
  }
  const b = boardById.get(c.boardId);
  let listId = listKey.get(`${c.listId}|${b._split ? c.swimlaneId : ''}`);
  if (!listId) {
    if (!orphanLists.has(c.boardId)) {
      const id = `${c.boardId}-unsorted`;
      orphanLists.set(c.boardId, id);
      lists.push({ id, board_id: c.boardId, title: 'Unsorted (imported)', position: b._nextPos++, archived: 0, created_at: new Date().toISOString() });
      warn(`board "${b.title}" has cards whose list is missing; they are in "Unsorted (imported)"`);
    }
    listId = orphanLists.get(c.boardId);
  }

  let description = c.description || '';
  for (const cl of (checklistsByCard.get(c._id) || []).sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0))) {
    const items = (itemsByChecklist.get(cl._id) || []).sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    description += `${description.trim() ? '\n\n' : ''}### ${cl.title || 'Checklist'}\n` +
      items.map((i) => `- [${i.isFinished ? 'x' : ' '}] ${String(i.title).replace(/\n+/g, ' ')}`).join('\n');
  }

  const labels = (c.labelIds || []).map((lid) => b.labels?.find((l) => l._id === lid)?.name || b.labels?.find((l) => l._id === lid)?.color).filter(Boolean);
  const people = (ids) => (ids || []).map((id) => usernameOf.get(id)).filter(Boolean).map((n) => `@${n}`).join(', ');
  const extras = [
    labels.length && `**Labels:** ${labels.join(', ')}`,
    people(c.members) && `**Members:** ${people(c.members)}`,
    people(c.assignees) && `**Assignees:** ${people(c.assignees)}`,
    day(c.receivedAt) && `**Received:** ${day(c.receivedAt)}`,
    day(c.startAt) && `**Start:** ${day(c.startAt)}`,
    day(c.endAt) && `**End:** ${day(c.endAt)}`,
    c.parentId && cardTitle.get(c.parentId) && `**Subtask of:** ${cardTitle.get(c.parentId)}`,
  ].filter(Boolean);
  if (extras.length) description += `${description.trim() ? '\n\n' : ''}---\n_Imported from WeKan_ · ${extras.join(' · ')}`;

  if (SKIP_ARCHIVED && (c.archived || lists.find((l) => l.id === listId)?.archived)) continue;
  cards.push({
    id: c._id,
    board_id: c.boardId,
    list_id: listId,
    title: c.title || 'Untitled',
    description,
    position: Number.isFinite(c.sort) ? c.sort : 0,
    archived: c.archived ? 1 : 0,
    due_at: day(c.dueAt),
    created_by: uid(c.userId),
    created_at: iso(c.createdAt) || new Date().toISOString(),
    updated_at: iso(c.modifiedAt) || iso(c.dateLastActivity) || iso(c.createdAt) || new Date().toISOString(),
  });
}
const importedCards = new Set(cards.map((c) => c.id));
if (SKIP_ARCHIVED) {
  const keep = new Set(lists.filter((l) => !l.archived).map((l) => l.id));
  lists.splice(0, lists.length, ...lists.filter((l) => keep.has(l.id)));
}

const comments = wComments.filter((c) => importedCards.has(c.cardId)).map((c) => ({
  id: c._id,
  card_id: c.cardId,
  user_id: uid(c.userId),
  text: c.text || '',
  created_at: iso(c.createdAt) || new Date().toISOString(),
  updated_at: iso(c.modifiedAt) || iso(c.createdAt) || new Date().toISOString(),
}));

// ------------------------------------------------------------------ attachments
const bucket = (name) => new GridFSBucket(mdb, { bucketName: name });
const toObjectId = (id) => (id instanceof ObjectId ? id : ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : id);
const readStream = (s) => new Promise((resolve, reject) => {
  const chunks = [];
  s.on('data', (c) => chunks.push(c)).on('error', reject).on('end', () => resolve(Buffer.concat(chunks)));
});

// Resolve a WeKan container path (e.g. /data/attachments/x.png) to a host path.
function hostPath(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  if (!WEKAN_FILES) return null;
  const rel = p.replace(/^\/data\/?/, '');
  for (const candidate of [path.join(WEKAN_FILES, rel), path.join(WEKAN_FILES, 'files', rel), path.join(WEKAN_FILES, path.basename(p))]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const attachmentJobs = [];
for (const a of wAttachments) {
  const v = a.versions?.original || {};
  const storage = v.storage || 'fs';
  attachmentJobs.push({
    row: {
      id: String(a._id),
      card_id: a.meta.cardId,
      user_id: uid(a.userId),
      filename: a.name || 'file',
      mime_type: a.type || a.mime || 'application/octet-stream',
      size: a.size || v.size || 0,
      created_at: iso(a.meta?.uploadedAt) || (ObjectId.isValid(String(a._id)) ? new ObjectId(String(a._id)).getTimestamp().toISOString() : new Date().toISOString()),
    },
    read: async () => {
      if (storage === 'gridfs') {
        const gid = v.meta?.gridFsFileId;
        for (const name of ['attachments', 'cfs_gridfs.attachments']) {
          if (!names.has(`${name}.files`)) continue;
          if (await mdb.collection(`${name}.files`).findOne({ _id: toObjectId(gid) })) return readStream(bucket(name).openDownloadStream(toObjectId(gid)));
        }
        throw new Error(`GridFS file ${gid} not found`);
      }
      if (storage === 'fs') {
        const p = hostPath(v.path) || hostPath(a.path);
        if (!p) throw new Error(`file not found on disk (${v.path || a.path}); pass --wekan-files <host path of WeKan's /data>`);
        return fs.readFileSync(p);
      }
      throw new Error(`storage "${storage}" is not supported; download it from WeKan manually`);
    },
  });
}
// Legacy CollectionFS (WeKan < v6).
for (const a of wCfsAttachments) {
  const key = a.copies?.attachments?.key;
  attachmentJobs.push({
    row: {
      id: String(a._id),
      card_id: a.cardId,
      user_id: uid(a.userId),
      filename: a.original?.name || 'file',
      mime_type: a.original?.type || 'application/octet-stream',
      size: a.original?.size || 0,
      created_at: iso(a.uploadedAt) || new Date().toISOString(),
    },
    read: async () => {
      if (!key) throw new Error('no stored copy');
      return readStream(bucket('cfs_gridfs.attachments').openDownloadStream(toObjectId(key)));
    },
  });
}

// ------------------------------------------------------------------ write
const counts = { users: 0, boards: 0, board_members: 0, lists: 0, cards: 0, comments: 0, attachments: 0 };
const insert = (table, rows) => {
  if (!rows.length || DRY) { counts[table] += DRY ? rows.length : 0; return; }
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`);
  for (const r of rows) counts[table] += stmt.run(r).changes;
};

if (!DRY) {
  db.transaction(() => {
    insert('users', users);
    insert('boards', boards);
    insert('board_members', members);
    insert('lists', lists);
    insert('cards', cards);
    insert('comments', comments);
  })();
} else {
  Object.entries({ users, boards, board_members: members, lists, cards, comments }).forEach(([t, r]) => insert(t, r));
}

const attachmentRows = [];
for (const job of attachmentJobs) {
  const { row } = job;
  if (!importedCards.has(row.card_id)) continue;
  if (!DRY && db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(row.id)) continue;
  try {
    const buf = await job.read();
    row.size = buf.length;
    row.storage_path = path.join(row.card_id, row.id);
    if (!DRY) {
      fs.mkdirSync(path.join(UPLOADS_DIR, row.card_id), { recursive: true });
      fs.writeFileSync(path.join(UPLOADS_DIR, row.storage_path), buf);
    }
    attachmentRows.push(row);
  } catch (e) {
    warn(`attachment "${row.filename}" on card "${cardTitle.get(row.card_id)}": ${e.message}`);
  }
}
insert('attachments', attachmentRows);
await client.close();

// ------------------------------------------------------------------ report
console.log(`\n${DRY ? 'Would import' : 'Imported'} into ${DRY ? '(dry run)' : DB_PATH}:`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(14)} ${v}`);
const archivedCards = cards.filter((c) => c.archived).length;
if (archivedCards) console.log(`  (${archivedCards} of the cards are archived; see "Archive" on each board)`);
if (warnings.length) console.log(`\n${warnings.length} warning(s), listed above.`);
if (!DRY) {
  const report = path.join(path.dirname(DB_PATH), `wekan-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(report, JSON.stringify({ source: MONGO_URL.replace(/\/\/[^@]*@/, '//***@'), counts, warnings }, null, 2));
  console.log(`Report: ${report}`);
  if (users.some((u) => u.password_hash)) console.log('\nWeKan users can log in with their existing WeKan username/email and password.');
}
