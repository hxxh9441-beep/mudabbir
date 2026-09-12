// src/utils/ringDays.ts
// أيام الحلقة: مصدرٌ واحد لفهرس الأيام، فلا تختلف اللوحة عن الخطّة عن مُنهي اليوم.
// activeDays مُخزَّنة بترتيب [السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة]
// بينما getDay() في JS يعطي الأحد = 0 ⇒ التحويل (getDay()+1) % 7.
import type { Ring } from '../db/schema';

export const DAY_NAMES = [
  'السبت',
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
] as const;

/** فهرس اليوم (0..6) في مصفوفة activeDays. */
export const dayIndexOf = (date: string): number =>
  (new Date(`${date}T00:00:00`).getDay() + 1) % 7;

/** هل التاريخ يومُ عملٍ للحلقة؟ */
export const isWorkDay = (ring: Pick<Ring, 'activeDays'>, date: string): boolean =>
  !!ring.activeDays[dayIndexOf(date)];

/** هل التسميع مسموحٌ في هذا التاريخ؟ (أيام الإجازة تحتاج الإذن الصريح). */
export const recitationAllowed = (
  ring: Pick<Ring, 'activeDays' | 'allowOffDayRecitation'>,
  date: string,
): boolean => isWorkDay(ring, date) || !!ring.allowOffDayRecitation;

/** إضافة/طرح أيام على تاريخ ISO (بالتوقيت المحلي، بلا انزياح المناطق). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** فرق الأيام بين تاريخين (موجب إذا كان b بعد a). */
export const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000,
  );

/** بداية أسبوع الحلقة (السبت) الذي يقع فيه التاريخ. */
export const weekStartOf = (date: string): string => addDays(date, -dayIndexOf(date));

/** أيام العمل بين تاريخين (شامل الطرفين) — بترتيب زمني. */
export function workDaysBetween(
  ring: Pick<Ring, 'activeDays'>,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  if (n < 0) return out;
  for (let k = 0; k <= n; k += 1) {
    const d = addDays(from, k);
    if (isWorkDay(ring, d)) out.push(d);
  }
  return out;
}
