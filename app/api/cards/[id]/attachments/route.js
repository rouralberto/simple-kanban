import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { getDb, newId, UPLOADS_DIR } from '@/lib/db';
import { currentUser, canAccessBoard } from '@/lib/auth';

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;

export async function POST(request, { params }) {
  const { id: cardId } = await params;
  const user = await currentUser();
  const card = getDb().prepare('SELECT id, board_id FROM cards WHERE id = ?').get(cardId);
  if (!user || !card || !canAccessBoard(user, card.board_id)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const form = await request.formData();
  const files = form.getAll('file').filter((f) => typeof f === 'object' && f.size > 0);
  if (!files.length) return Response.json({ error: 'No file' }, { status: 400 });
  if (files.some((f) => f.size > MAX_BYTES)) {
    return Response.json({ error: `Files must be under ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }

  const insert = getDb().prepare(`INSERT INTO attachments (id, card_id, user_id, filename, mime_type, size, storage_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const file of files) {
    const id = newId();
    const storagePath = path.join(cardId, id);
    fs.mkdirSync(path.join(UPLOADS_DIR, cardId), { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, storagePath), Buffer.from(await file.arrayBuffer()));
    insert.run(id, cardId, user.id, file.name || 'file', file.type || 'application/octet-stream', file.size, storagePath);
  }

  revalidatePath(`/b/${card.board_id}`);
  return Response.json({ ok: true });
}
