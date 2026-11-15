import type { Ring, Session, Student } from '../src/db/schema';

export const baseStudent = (over: Partial<Student> = {}): Student => ({
  id: 1,
  ringId: 1,
  name: 'طالب',
  level: '',
  hifzTarget: 5,
  murajaahTarget: 1,
  status: 'present',
  lastUpdated: new Date('2026-11-01T00:00:00'),
  ...over,
});

/** طالبٌ بعد التأسيس: يحفظ من البقرة نحو الناس */
export const baqarahStudent = (over: Partial<Student> = {}): Student =>
  baseStudent({
    hifzStartSurah: 2,
    hifzStartAyah: 1,
    hifzDirection: 'baqarah-to-nas',
    murajaahStartSurah: 2,
    murajaahStartAyah: 1,
    murajaahDirection: 'baqarah-to-nas',
    ...over,
  });

/** أحد → خميس عمل، الجمعة والسبت إجازة: [سبت، أحد، اثنين، ثلاثاء، أربعاء، خميس، جمعة] */
export const ring = (over: Partial<Ring> = {}): Ring => ({
  id: 1,
  name: 'حلقة',
  period: 'Asr',
  weekStartDay: 0,
  activeDays: [false, true, true, true, true, true, false],
  ...over,
});

export const session = (day: string, over: Partial<Session> = {}): Session => ({
  studentId: 1,
  date: new Date(`${day}T12:00:00`),
  day,
  hifzLines: 0,
  murajaahPages: 0,
  score: 0,
  createdAt: new Date(`${day}T12:00:00`),
  ...over,
});
