import { describe, expect, it } from 'vitest';
import { addDays, dayIndexOf, daysBetween, isWorkDay, weekStartOf } from '../src/utils/ringDays';

describe('ringDays', () => {
  it('السبت = 0 والجمعة = 6', () => {
    expect(dayIndexOf('2026-11-14')).toBe(0); // سبت
    expect(dayIndexOf('2026-11-15')).toBe(1); // أحد
    expect(dayIndexOf('2026-11-20')).toBe(6); // جمعة
  });
  it('addDays يعبر الشهر والسنة', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('daysBetween موجب إذا كان الثاني بعد الأول', () => {
    expect(daysBetween('2026-11-01', '2026-11-15')).toBe(14);
    expect(daysBetween('2026-11-15', '2026-11-01')).toBe(-14);
  });
  it('weekStartOf يرجع إلى السبت', () => {
    expect(weekStartOf('2026-11-18')).toBe('2026-11-14');
    expect(weekStartOf('2026-11-14')).toBe('2026-11-14');
  });
  it('isWorkDay يحترم activeDays', () => {
    const ring = { activeDays: [true, true, true, true, true, false, false] };
    expect(isWorkDay(ring, '2026-11-14')).toBe(true); // سبت
    expect(isWorkDay(ring, '2026-11-19')).toBe(false); // خميس
  });
});
