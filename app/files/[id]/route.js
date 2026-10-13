import fs from 'node:fs';
import path from 'node:path';
import { getDb, UPLOADS_DIR } from '@/lib/db';
import { currentUser, canAccessBoard } from '@/lib/auth';

// Types safe to render inline; everything else is forced to download.
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|video\/(mp4|webm)|audio\/)/;

export async function GET(request, { params }) {
  const { id } = await params;
  const user = await currentUser();
  const a = getDb().prepare(`SELECT a.*, c.board_id FROM attachments a JOIN cards c ON c.id = a.card_id WHERE a.id = ?`).get(id);
  if (!user || !a || !canAccessBoard(user, a.board_id)) return new Response('Not found', { status: 404 });

  const full = path.join(UPLOADS_DIR, a.storage_path);
  if (!full.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(full)) return new Response('File missing', { status: 404 });

  const download = new URL(request.url).searchParams.has('download') || !INLINE.test(a.mime_type);
  const name = encodeURIComponent(a.filename);
  return new Response(fs.readFileSync(full), {
    headers: {
      'Content-Type': a.mime_type,
      'Content-Length': String(fs.statSync(full).size),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
