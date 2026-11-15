import 'fake-indexeddb/auto';
import { Dexie } from 'dexie';
import { describe, expect, it } from 'vitest';
import { tablesV4 } from '../src/db/schema';

describe('الترقية ٥: حقل day وفهارس الجلسات', () => {
  it('تملأ day للصفوف القديمة ويجدها الفهرس المركّب', async () => {
    // قاعدةٌ بالإصدار ٤ كما عند مستخدمٍ حاليّ، بجلسةٍ بلا day
    const old = new Dexie('QuranCircleDB');
    old.version(4).stores(tablesV4);
    await old.open();
    await old.table('sessions').add({
      studentId: 7,
      date: new Date('2026-11-10T12:00:00'),
      hifzLines: 5,
      murajaahPages: 1,
      score: 18,
      createdAt: new Date(),
    });
    old.close();

    const idx = await import('../src/db/index');
    await idx.db.open();
    expect(idx.db.verno).toBe(5);
    const found = await idx.getDaySession(7, '2026-11-10');
    expect(found?.day).toBe('2026-11-10');
    expect(await idx.getDaySession(7, '2026-11-11')).toBeNull();

    // الكتابة الجديدة تُسجّل day
    await idx.markNotMemorized(8, '2026-11-12', 'hifz', 'x');
    expect((await idx.getDaySession(8, '2026-11-12'))?.day).toBe('2026-11-12');

    const map = await idx.getDaySessions('2026-11-10', [7, 8]);
    expect(Object.keys(map)).toEqual(['7']);
  });

  it('backfillSessionDays يُصلح صفوفاً مُستعادة بلا day', async () => {
    const { db, backfillSessionDays, getDaySession } = await import('../src/db/index');
    const id = await db.session.add({
      studentId: 9,
      date: new Date('2026-10-01T12:00:00'),
      hifzLines: 0,
      murajaahPages: 0,
      score: 0,
      createdAt: new Date(),
    });
    expect(await getDaySession(9, '2026-10-01')).toBeNull();
    expect(await backfillSessionDays()).toBeGreaterThanOrEqual(1);
    expect((await getDaySession(9, '2026-10-01'))?.id).toBe(id);
  });
});
