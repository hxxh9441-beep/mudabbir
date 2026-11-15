import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

// loadCurriculum() يجلب الفهرس بـfetch — نخدمه من الملفّ الحقيقيّ.
vi.stubGlobal('fetch', async (url: string) => {
  const file = resolve(process.cwd(), 'public', String(url).replace(/^\//, ''));
  const body = readFileSync(file, 'utf8');
  return { ok: true, json: async () => JSON.parse(body) } as Response;
});
