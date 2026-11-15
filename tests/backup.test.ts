import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/index';
import {
  daysSinceBackup,
  exportBackup,
  markBackupDone,
  readBackup,
  restoreBackup,
} from '../src/db/backup';

const ring = { name: 'حلقة', period: 'Asr' as const, weekStartDay: 0, activeDays: Array(7).fill(true) };

async function seed() {
  const ringId = await db.ring.add(ring);
  const sid = await db.student.add({
    ringId,
    name: 'طالب',
    level: '',
    hifzTarget: 5,
    murajaahTarget: 1,
    status: 'present',
    lastUpdated: new Date(),
  });
  await db.attendance.add({ studentId: sid, date: '2026-11-15', status: 'present', updatedAt: new Date() });
}

beforeEach(async () => {
  await db.open();
  await Promise.all([db.ring.clear(), db.student.clear(), db.session.clear(), db.attendance.clear()]);
  localStorage.clear();
});

describe('النسخ الاحتياطي', () => {
  it('تصدير ثم استعادة يعيد البيانات كما كانت', async () => {
    await seed();
    const backup = await exportBackup();
    await db.student.clear();
    expect(await db.student.count()).toBe(0);
    await restoreBackup(backup);
    expect(await db.student.count()).toBe(1);
    expect(await db.attendance.count()).toBe(1);
  });

  it('ملفٌّ تالف يُرفض في readBackup', async () => {
    await expect(readBackup(new Blob(['not json']))).rejects.toThrow();
    await expect(readBackup(new Blob(['{"formatName":"x"}']))).rejects.toThrow();
  });

  it('نسخةٌ من إصدار مخطّطٍ أحدث تُرفض', async () => {
    await seed();
    const text = await (await exportBackup()).text();
    const j = JSON.parse(text);
    j.data.databaseVersion = db.verno + 5;
    await expect(readBackup(new Blob([JSON.stringify(j)]))).rejects.toThrow(/أحدث/);
  });

  it('فشل الاستيراد يُرجع البيانات الأصليّة (تراجع تلقائي)', async () => {
    await seed();
    // ملفٌّ صالح الرأس لكن بياناته مخالفةٌ للقيد الفريد [studentId+date]
    const text = await (await exportBackup()).text();
    const j = JSON.parse(text);
    const att = j.data.data.find((t: { tableName: string }) => t.tableName === 'attendance');
    att.rows.push({ ...att.rows[0], id: 999 });
    att.rowCount = att.rows.length;
    j.data.tables.find((t: { name: string }) => t.name === 'attendance').rowCount = att.rows.length;
    await db.student.update((await db.student.toArray())[0].id!, { name: 'قبل الاستعادة' });

    await expect(restoreBackup(new Blob([JSON.stringify(j)]))).rejects.toThrow();
    const s = await db.student.toArray();
    expect(s).toHaveLength(1);
    expect(s[0].name).toBe('قبل الاستعادة');
  });

  it('تتبّع آخر نسخة', () => {
    expect(daysSinceBackup()).toBeNull();
    markBackupDone(new Date('2026-11-01T10:00:00Z'));
    expect(daysSinceBackup(new Date('2026-11-15T10:00:00Z'))).toBe(14);
  });
});
