// src/utils/planProjection.ts
// الخطّة الأسبوعية الحقيقية: مقطعٌ محدَّد (سورة/آية) لكل يوم عمل.
//
// المبدأ:
//   • **المستقبل يُحسَب من آخر تقدّم فعلي** (الموضع الجاري للطالب) — نمشي يوماً
//     بيوم فنستهلك المقدار اليومي ونربط كل يومٍ بما بعده: لا فراغات ولا تكرار.
//   • **الماضي مرساةٌ ثابتة**: كل يومٍ سُجّل فيه تسميعٌ نعرض مقطعه الفعلي
//     (`hifzFrom/To`، `murajaahFrom/To`) ونُقفز المؤشّر إلى نهايته، فأيُّ تعديلٍ
//     يدويّ في جلسةٍ سابقة يبقى استثناءً محفوظاً وتُعاد الجدولة من بعده.
//   • **أيام الإجازة تُتخطّى** ولا تُكلَّف شيئاً، إلا إن سُجّل فيها فعلاً (تجاوزٌ
//     يدويّ بإذن «إتاحة التسميع في أيام الإجازة») فتُعرض بما فيها ولا تُحسب لها
//     مهمّةٌ جديدة.
import type { Ring, Session, Student } from '../db/schema';
import type { Position } from './progression';
import { surahShort } from './progression';
import {
  currentPositionOf,
  onboardingAt,
  murajaahBoundsOf,
  nextHifzWindow,
  planRangeLabel,
  positionAfterRecited,
  sliceFrom,
  type PlanMode,
  type PlanSlice,
  type Portion,
} from './dailyPlan';
import { DAY_NAMES, addDays, dayIndexOf, isWorkDay, workDaysBetween } from './ringDays';

export const isoD = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface PlanDay {
  date: string;
  weekday: number; // 0 = السبت
  dayName: string;
  dayOfMonth: number;
  month: number;
  /** يومُ عملٍ للحلقة */
  work: boolean;
  isPast: boolean;
  isToday: boolean;
  /** مقطع الحفظ لهذا اليوم (محسوبٌ للمستقبل، فعليٌّ للماضي المسجَّل) */
  hifz: PlanSlice | null;
  /** مقطع المراجعة لهذا اليوم */
  murajaah: PlanSlice | null;
  /** سُجّل فيه تسميعٌ فعلاً (مرساة) */
  recorded: boolean;
  score?: number;
  /** هل خرج الطالب منه بمقطعٍ فعليّ مُختلف عن المخطَّط؟ (تعديلٌ يدويّ) */
  adjusted: boolean;
  /** مرحلة تأسيس جزء عمّ ⇒ المراجعة موقوفة في هذا اليوم */
  murajaahSuspended: boolean;
}

export interface WeekPlan {
  weekStart: string;
  weekEnd: string;
  days: PlanDay[];
  hifzQuota: number;
  murajaahQuota: number;
  /** عدد الأيام المسجَّلة في هذا الأسبوع */
  recordedCount: number;
}

/** مقطعٌ من مقطعٍ فعليّ مخزَّن (للعرض) — بلا إعادة حساب. */
function actualSlice(
  mode: PlanMode,
  from: Position,
  to: Position,
  amount: number,
): PlanSlice {
  const unit = mode === 'hifz' ? 'أسطر' : 'أوجه';
  return {
    mode,
    from,
    to,
    range: planRangeLabel(from, to),
    label:
      from.surah === to.surah && from.ayah === to.ayah
        ? `الآية ${surahShort(from.surah)} ${from.ayah}`
        : `من ${surahShort(from.surah)} ${from.ayah} إلى ${surahShort(to.surah)} ${to.ayah}`,
    amount,
    unit,
    ayahs: 0,
    pages: 0,
    nextStart: null,
    // المقطع المخزَّن هو المقطع الجديد نفسه (المرساة)
    newFrom: from,
    newTo: to,
    newRange: planRangeLabel(from, to),
    kind: mode === 'hifz' ? 'rolling' : 'simple',
  };
}

/**
 * يبني خطة أسبوعٍ كامل (٧ أيام من `weekStart`) لطالب.
 * `sessions` = جلسات الطالب (للمراسي)، يُمرَّر من useLiveQuery فيبقى العرض حيّاً.
 */
export function projectRange(opts: {
  student: Student;
  ring: Ring;
  sessions: Session[];
  /** أول يوم في المدى (شامل) */
  from: string;
  /** آخر يوم في المدى (شامل) */
  to: string;
  today?: string;
}): WeekPlan {
  const { student, ring, sessions } = opts;
  const today = opts.today ?? isoD();
  const weekStart = opts.from;
  const weekEnd = opts.to;

  const byDate = new Map<string, Session>();
  for (const s of sessions) byDate.set(isoD(new Date(s.date)), s);

  const hifzDir = student.hifzDirection ?? 'nas-to-baqarah';
  const murajaahDir = student.murajaahDirection ?? 'nas-to-baqarah';
  /** تُحسب من موضع اليوم في كل خطوة — لا مرةً واحدةً من الموضع المخزَّن */
  const boundsFor = (p: Position | null) => murajaahBoundsOf(student, p);

  // مؤشّر المستقبل: يبدأ من آخر تقدّم فعليّ للطالب
  const cursor: { hifz: Position | null; murajaah: Position | null } = {
    hifz: currentPositionOf(student, 'hifz'),
    murajaah: currentPositionOf(student, 'murajaah'),
  };
  /** نافذة الربط التراكمي أثناء الإسقاط: نبنيها من مقاطع الماضي ثم نُمرّرها */
  let win: Portion[] = [];

  // نطاق المشي: من أقدم نقطة نحتاجها (بداية الأسبوع أو اليوم) إلى نهايته،
  // فنضمن أن مؤشّر الأسبوع القادم يبدأ من حيث ينتهي هذا الأسبوع.
  const walkFrom = weekStart < today ? weekStart : today;
  const planned = new Map<string, { hifz: PlanSlice | null; murajaah: PlanSlice | null }>();
  /** أي يومٍ كان في مرحلة تأسيس جزء عمّ (فلا مراجعة فيه) */
  const onbFlags = new Map<string, boolean>();

  for (const date of workDaysBetween(ring, walkFrom, weekEnd)) {
    if (date < today) {
      const sess = byDate.get(date);
      // ⓐ ما كان مخطَّطاً لهذا اليوم من المؤشّر — نعرضه فيُرى تسلسل الأسبوع
      const hPast = cursor.hifz ? sliceFrom(student, 'hifz', cursor.hifz, win) : null;
      // في التأسيس لا مراجعة: الفحص على موضع اليوم نفسه
      const onbPast = cursor.hifz ? onboardingAt(student, cursor.hifz) : false;
      const mPast =
        !onbPast && cursor.murajaah
          ? sliceFrom(student, 'murajaah', cursor.murajaah, undefined, cursor.hifz)
          : null;
      onbFlags.set(date, onbPast);
      planned.set(date, { hifz: hPast, murajaah: mPast });
      // ⓑ تقدّم بالمخطَّط (فيتسلسل الأسبوع الماضي أيضاً)
      if (hPast?.nextStart) cursor.hifz = hPast.nextStart;
      if (mPast?.nextStart) cursor.murajaah = mPast.nextStart;
      // ⓒ ثم المرساة الفعلية تُصحّح الموضع — وهي الأصدق، فما سُمِع فعلاً هو
      //     الحقيقة وكلُّ ما بعده يُعاد حسابه منه (لا من المخطَّط)
      if (sess?.hifzFrom && sess?.hifzTo) {
        // المرساة الفعلية: المقطع المسجَّل يدخل النافذة، والموضع يقفز إلى نهايته
        win = nextHifzWindow(win, { from: sess.hifzFrom, to: sess.hifzTo });
      } else if (hPast) {
        win = nextHifzWindow(win, { from: hPast.newFrom, to: hPast.newTo });
      }
      if (sess?.hifzTo) {
        cursor.hifz = positionAfterRecited(sess.hifzTo, hifzDir) ?? cursor.hifz;
      }
      if (sess?.murajaahTo) {
        cursor.murajaah =
          positionAfterRecited(sess.murajaahTo, murajaahDir, boundsFor(cursor.hifz)) ?? cursor.murajaah;
      }
      continue;
    }
    // اليوم وما بعده: المقطع يُحسَب من المؤشّر ثم يتقدّم به.
    // ⚠️ **التأسيس يُقاس بموضع بداية اليوم** قبل تقدّمه: يومُ إتمام الفجر يبقى
    // تأسيسيّاً (بلا مراجعة) كما تقتضي القاعدة، والمراجعة تبدأ من اليوم التالي.
    const onbNow = cursor.hifz ? onboardingAt(student, cursor.hifz) : false;
    const h = cursor.hifz ? sliceFrom(student, 'hifz', cursor.hifz, win) : null;
    if (h) win = nextHifzWindow(win, { from: h.newFrom, to: h.newTo });
    if (h?.nextStart) cursor.hifz = h.nextStart;
    const m =
      !onbNow && cursor.murajaah
        ? sliceFrom(student, 'murajaah', cursor.murajaah, undefined, cursor.hifz)
        : null;
    onbFlags.set(date, onbNow);
    if (m?.nextStart) cursor.murajaah = m.nextStart;
    planned.set(date, { hifz: h, murajaah: m });
  }

  const days: PlanDay[] = [];
  const spanDays = Math.max(1, Math.round((Date.parse(`${weekEnd}T00:00:00`) - Date.parse(`${weekStart}T00:00:00`)) / 86400000) + 1);
  for (let i = 0; i < spanDays; i += 1) {
    const date = addDays(weekStart, i);
    const d = new Date(`${date}T00:00:00`);
    const work = isWorkDay(ring, date);
    const sess = byDate.get(date);
    const recordedHifz = !!sess && (sess.hifzResult === 'recited' || (sess.hifzLines ?? 0) > 0);
    const recordedMurajaah =
      !!sess && (sess.murajaahResult === 'recited' || (sess.murajaahPages ?? 0) > 0);
    const recorded = recordedHifz || recordedMurajaah;

    let hifz: PlanSlice | null = null;
    let murajaah: PlanSlice | null = null;
    let adjusted = false;

    if (recordedHifz && sess?.hifzFrom && sess?.hifzTo) {
      hifz = actualSlice('hifz', sess.hifzFrom, sess.hifzTo, sess.hifzLines ?? 0);
    } else if (recordedHifz && sess) {
      // صفوفٌ قديمة بلا مقطع مخزَّن: نعرض ما في الملاحظة (وصفٌ فقط)
      hifz = null;
    } else if (!recorded && (work || sess)) {
      hifz = planned.get(date)?.hifz ?? null;
    }
    if (recordedMurajaah && sess?.murajaahFrom && sess?.murajaahTo) {
      murajaah = actualSlice('murajaah', sess.murajaahFrom, sess.murajaahTo, sess.murajaahPages ?? 0);
    } else if (!recorded && (work || sess)) {
      murajaah = planned.get(date)?.murajaah ?? null;
    }

    // هل خالف الفعليُّ ما كان مخطَّطاً؟ (تعديلٌ يدويّ في الجلسة)
    if (recorded && hifz) {
      const p = planned.get(date)?.hifz;
      adjusted =
        !!p && (p.to.surah !== hifz.to.surah || p.to.ayah !== hifz.to.ayah);
    }

    days.push({
      date,
      weekday: dayIndexOf(date),
      dayName: DAY_NAMES[dayIndexOf(date)],
      dayOfMonth: d.getDate(),
      month: d.getMonth() + 1,
      work,
      isPast: date < today,
      isToday: date === today,
      hifz,
      murajaah,
      recorded,
      score: sess?.score,
      adjusted,
      murajaahSuspended: !murajaah && !!onbFlags.get(date),
    });
  }

  return {
    weekStart,
    weekEnd,
    days,
    hifzQuota: student.hifzTarget ?? 0,
    murajaahQuota: student.murajaahTarget ?? 0,
    recordedCount: days.filter((d) => d.recorded).length,
  };
}

/** الأسبوع: غلافٌ رقيق حول projectRange (سبعة أيام) — يبقى كما كان للواجهة. */
export function projectWeek(opts: {
  student: Student;
  ring: Ring;
  sessions: Session[];
  weekStart: string;
  today?: string;
}): WeekPlan {
  return projectRange({ ...opts, from: opts.weekStart, to: addDays(opts.weekStart, 6) });
}

/** أول وآخر يومٍ في شهرٍ معيّن بصيغة YYYY-MM */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate(); // اليوم ٠ من الشهر التالي = آخر هذا الشهر
  return { from, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * **الشهر كاملاً** — للمصدَّر (PDF/Excel): نفس محرّك الإسقاط لكن على مدى شهرٍ
 * واحد، فيتسلسل الحفظ والمراجعة عبر الأسابيع الأربعة/الخمسة بلا انقطاعٍ ولا
 * تكرار (النافذة والمؤشّر يستمرّان من أول الشهر إلى آخره).
 */
export function projectMonth(opts: {
  student: Student;
  ring: Ring;
  sessions: Session[];
  /** YYYY-MM */
  month: string;
  today?: string;
}): WeekPlan {
  const { from, to } = monthBounds(opts.month);
  return projectRange({ ...opts, from, to });
}
