import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveStudent,
  createStudent,
  db,
  deleteStudentWithRecords,
  finalizePastDays,
  getAttendance,
  isoDay,
  restoreStudent,
  setAttendance,
  studentsOfRing,
} from '../src/db/index';
import { exportBackup, restoreBackup } from '../src/db/backup';
import { ring as ringFixture, session } from './fixtures';

const fields = (name: string) => ({ name, level: '', hifzTarget: 5, murajaahTarget: 1 }) as never;
const TODAY = '2026-11-18'; // أربعاء
let ringId: number;

beforeEach(async () => {
  await db.open();
  await Promise.all([db.ring.clear(), db.student.clear(), db.session.clear(), db.attendance.clear()]);
  const { id: _id, ...r } = ringFixture();
  ringId = (await db.ring.add(r)) as number;
});

const mk = async (name: string, activeSince?: string) => {
  const s = await createStudent(ringId, fields(name));
  // createStudent يضبط activeSince = اليوم الفعلي؛ نتحكّم به في الاختبار
  await db.student.update(s!.id!, { activeSince });
  return s!.id!;
};

describe('الأرشفة', () => {
  it('الأرشفة تُخرج الطالب من النشطين وتُبقي سجلاته', async () => {
    const id = await mk('أحمد');
    await db.session.add(session('2026-11-15', { studentId: id, hifzLines: 5 }));
    await setAttendance(id, '2026-11-15', 'present');

    await archiveStudent(id);
    const { active, archived } = await studentsOfRing(ringId);
    expect(active).toHaveLength(0);
    expect(archived.map((s) => s.name)).toEqual(['أحمد']);
    expect(archived[0].archivedAt).toBeInstanceOf(Date);
    expect(await db.session.where('studentId').equals(id).count()).toBe(1);
    expect(await db.attendance.where('studentId').equals(id).count()).toBe(1);
  });

  it('الاستعادة تُعيده نشطاً وتمسح archivedAt', async () => {
    const id = await mk('أحمد');
    await archiveStudent(id);
    await restoreStudent(id);
    const { active, archived } = await studentsOfRing(ringId);
    expect(archived).toHaveLength(0);
    expect(active).toHaveLength(1);
    expect('archivedAt' in active[0] && active[0].archivedAt !== undefined).toBe(false);
    expect(active[0].activeSince).toBeTruthy();
  });

  it('الحذف النهائي يمحو الطالب وجلساته وحضوره، حتى لو كان مؤرشَفاً', async () => {
    const id = await mk('أحمد');
    const other = await mk('خالد');
    await db.session.add(session('2026-11-15', { studentId: id }));
    await db.session.add(session('2026-11-15', { studentId: other }));
    await setAttendance(id, '2026-11-15', 'present');
    await archiveStudent(id);

    await deleteStudentWithRecords(id);
    expect(await db.student.get(id)).toBeUndefined();
    expect(await db.session.where('studentId').equals(id).count()).toBe(0);
    expect(await db.attendance.where('studentId').equals(id).count()).toBe(0);
    // غيره لم يُمسّ
    expect(await db.session.where('studentId').equals(other).count()).toBe(1);
  });

  it('المؤرشَف لا يُثبَّت له غياب في قواعد نهاية اليوم', async () => {
    const id = await mk('أحمد', '2026-10-01');
    await archiveStudent(id);
    const ring = (await db.ring.get(ringId))!;
    await finalizePastDays(ring, TODAY);
    expect(await db.attendance.where('studentId').equals(id).count()).toBe(0);
  });

  it('بعد الاستعادة لا تُثبَّت غياباتٌ عن أيام الأرشفة', async () => {
    const id = await mk('أحمد', '2026-10-01');
    await archiveStudent(id);
    await restoreStudent(id);
    // activeSince = اليوم الفعلي ⇒ كل ما قبله خارج الحكم
    const ring = (await db.ring.get(ringId))!;
    await finalizePastDays(ring, isoDay());
    expect(await db.attendance.where('studentId').equals(id).count()).toBe(0);
  });

  it('الطالب الجديد لا يُثبَّت له غيابٌ عن أيامٍ سبقت إضافته', async () => {
    const id = await mk('جديد', '2026-11-18'); // أُضيف اليوم
    const ring = (await db.ring.get(ringId))!;
    await finalizePastDays(ring, TODAY);
    expect(await db.attendance.where('studentId').equals(id).count()).toBe(0);
  });

  it('وطالبٌ قديم بلا activeSince يُحسب كالسابق (غياب أيام العمل الماضية)', async () => {
    const id = await mk('قديم', undefined);
    const ring = (await db.ring.get(ringId))!;
    const fixed = await finalizePastDays(ring, TODAY, 3);
    expect(fixed).toBeGreaterThan(0);
    const att = await getAttendance('2026-11-17', [id]);
    expect(att[id]).toBe('absent');
  });

  it('النسخ الاحتياطي يحفظ حالة الأرشفة ويعيدها', async () => {
    const id = await mk('أحمد');
    await archiveStudent(id);
    const backup = await exportBackup();
    await db.student.clear();
    await restoreBackup(backup);
    const { active, archived } = await studentsOfRing(ringId);
    expect(active).toHaveLength(0);
    expect(archived).toHaveLength(1);
  });
});
