// src/utils/dailyPlan.ts
// مصدرٌ واحد لحقيقة «مهمّة اليوم»: يقرأ حالة الطالب من Dexie ويحسب المهمّة من
// محرّك التدرّج. تستخدمه البطاقة وورقة التسميع والخطّة الأسبوعية معاً — فلا
// يمكن أن يختلفا.
//
// وفيه قاعدتان منهجيتان:
//  ① **حفظ الربط التراكمي**: يُكرَّر المقطع الجديد ثلاثة أيام عملٍ متتالية
//     (اليوم + اليومان السابقان)، ثم يخرج من النافذة ويدخل المراجعة الاعتيادية.
//  ② **تأسيس جزء عمّ**: طالبٌ يبدأ من الناس ويسير نحو البقرة يُسمِّع صفحتين
//     يومياً تُضاف تراكمياً من الناس، حتى يبلغ سورة الفجر فينتقل إلى النظام
//     الاعتيادي (مقدار حفظٍ جديد + مقدار مراجعة مستقلّ).
import type { Student, ProgressDirection, Session } from '../db/schema';
import type { MemorizedRange, Position, WalkBounds } from './progression';
import {
  computeAssignment,
  distanceAlong,
  furtherPosition,
  globalIndex,
  memorizedFrom,
  nextPosition,
  pageOfPosition,
  surahShort,
} from './progression';

export type PlanMode = 'hifz' | 'murajaah';

/** أقدم سورة في نهاية التأسيس: بلوغها يُنهي «من الناس إلى الفجر». */
export const ONBOARDING_LAST_SURAH = 89; // الفجر
/** مقدار التأسيس: صفحتان تُضافان تراكمياً كل يوم */
export const ONBOARDING_PAGES = 2;
/** **الحدّ الصلب للتأسيس**: آخر آية من سورة الفجر (٨٩:٣٠ — الصفحة ٥٩٤).
 *  لا تتجاوزه الكتلة التراكمية أبداً؛ وبلوغُه يُغلق مرحلة التأسيس تماماً
 *  فيبدأ الحفظ الاعتيادي من سورة الغاشية (٨٨). */
export const ONBOARDING_CEILING: Position = { surah: ONBOARDING_LAST_SURAH, ayah: 30 };

export type HifzKind = 'simple' | 'rolling' | 'onboarding';

/** مقطعٌ محفوظ (بداية/نهاية) — يُستعمل في نافذة الربط وفي المراسي. */
export interface Portion {
  from: Position;
  to: Position;
}

export interface PlanSlice {
  mode: PlanMode;
  /** بداية المهمّة اليوم كاملةً (قد تشمل المقاطع المتراكمة) */
  from: Position;
  /** نهاية المهمّة اليوم */
  to: Position;
  /** وسم مختصر: «النبا 1 - 9» */
  range: string;
  label: string;
  /** مقدار **اليوم الجديد** (أسطر للحفظ / أوجه للمراجعة) */
  amount: number;
  unit: string;
  ayahs: number;
  pages: number;
  /** من أين يبدأ الغد */
  nextStart: Position | null;
  /** **المقطع الجديد وحده** — هو الذي يتقدّم به موضع الطالب */
  newFrom: Position;
  newTo: Position;
  newRange: string;
  /** طبيعة المقطع: اعتيادي / تراكمي (نافذة ٣ أيام) / تأسيس جزء عمّ */
  kind: HifzKind;
}

export interface DailyPlan extends PlanSlice {
  direction: ProgressDirection;
  /** الحفظ موقوف مؤقتاً ⇒ لا مهمّة حفظ اليوم */
  paused: boolean;
}

/** النطاق المختصر: «الفجر 1 - 14» أو «النبأ 1 - النازعات 15». */
export function planRangeLabel(from: Position, to: Position): string {
  const head = `${surahShort(from.surah)} ${from.ayah}`;
  if (from.surah === to.surah) return `${head} - ${to.ayah}`;
  return `${head} - ${surahShort(to.surah)} ${to.ayah}`;
}

/** نقطة الانطلاق الفعلية: الموضع الجاري إن وُجد، وإلا نقطة البداية. */
export function currentPositionOf(student: Student, mode: PlanMode): Position {
  if (mode === 'hifz') {
    return {
      surah: student.currentSurah ?? student.hifzStartSurah ?? 114,
      ayah: student.currentAyah ?? student.hifzStartAyah ?? 1,
    };
  }
  return {
    surah: student.murajaahCurrentSurah ?? student.murajaahStartSurah ?? 114,
    ayah: student.murajaahCurrentAyah ?? student.murajaahStartAyah ?? 1,
  };
}

/**
 * هل الموضع المُعطى داخل **تأسيس جزء عمّ**؟ (بداية من الناس · نحو البقرة · لم يبلغ الفجر)
 * تُستعمل أيضاً في الخطّة الأسبوعية لفحص حالة كل يوم على حدة.
 */
export function onboardingAt(student: Student, pos: Position): boolean {
  if ((student.hifzDirection ?? 'nas-to-baqarah') !== 'nas-to-baqarah') return false;
  const s = student.hifzStartSurah ?? 114;
  const a = student.hifzStartAyah ?? 1;
  if (s !== 114 || a !== 1) return false; // التأسيس يبدأ من الناس ١ حصراً
  return pos.surah > ONBOARDING_LAST_SURAH;
}

/** هل الطالب الآن في تأسيس جزء عمّ؟ */
export const onboardingActive = (student: Student): boolean =>
  onboardingAt(student, currentPositionOf(student, 'hifz'));

/** نقطة انطلاق التأسيس (الناس ١). */
export function onboardingStart(student: Student): Position {
  return { surah: student.hifzStartSurah ?? 114, ayah: student.hifzStartAyah ?? 1 };
}

/**
 * نطاق المحفوظ المُتقَن للطالب (الدرس الجاري خارج النطاق حتى يُكمَل).
 *
 * `hifzPos` — موضعٌ صريح يُحسب منه النطاق. **مهمّ**: في الإسقاط نُخطّط لأيامٍ
 * لم تُسمَّع بعد، فموضع الطالب المخزَّن لا يمثّلها؛ نُمرّر موضع اليوم المخطَّط
 * له فيصحّ النطاق (وإلا بقي فارغاً فاختفت المراجعة). وإن لم يُمرَّر نستعمل
 * المخزَّن — وهو الصحيح في «مهمّة اليوم».
 */
export function memorizedRangeOf(student: Student, hifzPos?: Position | null): MemorizedRange {
  const dir = student.hifzDirection ?? 'nas-to-baqarah';
  const start: Position = {
    surah: student.hifzStartSurah ?? 114,
    ayah: student.hifzStartAyah ?? 1,
  };
  const cur: Position | null =
    hifzPos ??
    (student.currentSurah !== undefined && student.currentAyah !== undefined
      ? { surah: student.currentSurah, ayah: student.currentAyah }
      : null);
  return memorizedFrom(furtherPosition(start, cur, dir), dir);
}

/** حدود المراجعة: نطاق المحفوظ مع دورانٍ عند طرفه (لا نصطدم بالجدار). */
export function murajaahBoundsOf(student: Student, hifzPos?: Position | null): WalkBounds | undefined {
  const r = memorizedRangeOf(student, hifzPos);
  if (r.empty) return undefined;
  return { minSurah: r.minSurah, maxSurah: r.maxSurah, cycle: true };
}

/** بناء مقطعٍ من حدّين معلومين (بلا إعادة حساب). */
function buildSlice(
  mode: PlanMode,
  direction: ProgressDirection,
  taskFrom: Position,
  taskTo: Position,
  newFrom: Position,
  newTo: Position,
  kind: HifzKind,
  amount: number,
  unit: 'lines' | 'pages',
  nextStart: Position | null,
): PlanSlice {
  const pf = pageOfPosition(taskFrom);
  const pt = pageOfPosition(taskTo);
  const pages = pf !== null && pt !== null ? Math.abs(pt - pf) + 1 : 0;
  return {
    mode,
    from: taskFrom,
    to: taskTo,
    range: planRangeLabel(taskFrom, taskTo),
    label:
      taskFrom.surah === taskTo.surah && taskFrom.ayah === taskTo.ayah
        ? `الآية ${surahShort(taskFrom.surah)} ${taskFrom.ayah}`
        : `من ${surahShort(taskFrom.surah)} ${taskFrom.ayah} إلى ${surahShort(taskTo.surah)} ${taskTo.ayah}`,
    amount,
    unit: unit === 'pages' ? 'أوجه' : 'أسطر',
    ayahs: distanceAlong(taskFrom, taskTo, direction),
    pages,
    nextStart,
    newFrom,
    newTo,
    newRange: planRangeLabel(newFrom, newTo),
    kind,
  };
}

/**
 * مقطعُ يومٍ من موضعٍ مُعطى — نواة كل الخطط (بطاقة/ورقة/أسبوع):
 *   • الحفظ الاعتيادي ⇒ **نافذة الربط التراكمي**: من أقدم مقطعٍ في النافذة
 *     (آخر مقطعين منجزين) إلى نهاية مقطع اليوم الجديد. ومع نافذةٍ فارغة
 *     (أول يوم) يكون المقطع الجديد وحده.
 *   • تأسيس جزء عمّ ⇒ من نقطة البداية (الناس) إلى نهاية صفحتَي اليوم الجديدتين
 *     ⇒ فالمتراكم ينمو صفحتين كل يوم، **مقيَّداً بنهاية سورة الفجر** فلا يتجاوزها.
 *   • المراجعة ⇒ مقدار الأوجه داخل نطاق المحفوظ (كما كانت).
 * `windowOverride` يُستعمل في الخطّة الأسبوعية لمحاكاة النافذة عبر الأيام.
 */
export function sliceFrom(
  student: Student,
  mode: PlanMode,
  from: Position,
  windowOverride?: Portion[],
  /** موضع حفظ اليوم المخطَّط له — يُصحّح فحص التأسيس وحدود المراجعة */
  hifzPosIn?: Position | null,
): PlanSlice | null {
  const isHifz = mode === 'hifz';
  const direction: ProgressDirection = isHifz
    ? (student.hifzDirection ?? 'nas-to-baqarah')
    : (student.murajaahDirection ?? 'nas-to-baqarah');

  if (!isHifz) {
    // **مرحلة تأسيس جزء عمّ: المراجعة موقوفة تماماً** — لا مقطع ولا مقدار،
    // والحفظ التراكمي وحده هو المسار، وتعود تلقائياً عند بلوغ الفجر.
    //
    // ⚠️ الفحص على **موضع اليوم المخطَّط له** (`hifzPos`) لا على موضع الطالب
    // المخزَّن: في الإسقاط نُخطّط لأيامٍ قادمة وموضع الطالب المخزَّن ما زال في
    // التأسيس، فكان الفحص يُبقي المراجعة مُعلَّقة إلى الأبد ⇒ اختفت من كل يومٍ
    // بعد الفجر. وهذا هو أصل العطل الذي رصده المعلّم.
    const hifzPos = hifzPosIn ?? currentPositionOf(student, 'hifz');
    if (onboardingAt(student, hifzPos)) return null;
    const amount = student.murajaahTarget ?? 0;
    if (amount <= 0) return null;
    const a = computeAssignment(from, direction, amount, 'pages', murajaahBoundsOf(student, hifzPos));
    if (!a) return null;
    return buildSlice(
      'murajaah',
      direction,
      a.from,
      a.to,
      a.from,
      a.to,
      'simple',
      amount,
      'pages',
      a.nextStart,
    );
  }

  // **الفحص على الموضع المُخطَّط له (`from`)** لا على موضع الطالب المخزَّن:
  // وبهذا تُغلق المرحلة في الخطّة الأسبوعية أيضاً لحظة بلوغ الفجر، لا في
  // خطّة اليوم وحده. (كان الخلل: قراءة موضع الطالب دائماً ⇒ لا تُغلق أبداً.)
  const onb = onboardingAt(student, from) && !student.hifzPaused;
  const amount = onb ? ONBOARDING_PAGES : (student.hifzTarget ?? 0);
  const unit: 'lines' | 'pages' = onb ? 'pages' : 'lines';
  if (amount <= 0) return null;

  // المقطع الجديد اليوم (من الموضع المُعطى) — وهو الذي يتقدّم به الموضع
  const newPart = computeAssignment(from, direction, amount, unit);
  if (!newPart) return null;

  // ⛔ الحدّ الصلب: لا تتجاوز الكتلة نهاية سورة الفجر؛ فإن تجاوزها المقطع
  // الجديد الطبيعي قُصَّ عندها، وكان موضع الغد الغاشية ١ (فيُغلق التأسيس).
  let newTo = newPart.to;
  let nextStart = newPart.nextStart;
  if (onb && furtherPosition(newPart.to, ONBOARDING_CEILING, direction) === newPart.to) {
    newTo = ONBOARDING_CEILING;
    nextStart = nextPosition(ONBOARDING_CEILING, direction);
  }

  // بداية المهمّة: نقطة التأسيس للناشئ، أو أقدم مقطعٍ في نافذة الربط.
  // ومقاطع التأسيس (الفجر وما بعده) تُستبعَد من النافذة: فمتى أُغلقت المرحلة
  // دخلت الكتلة كاملةً في مسار المراجعة، وبدأ حفظ الغاشية نظيفاً بلا تراكمٍ قديم.
  const win = (windowOverride ?? student.hifzWindow ?? []).filter(
    (p) => p.from.surah < ONBOARDING_LAST_SURAH,
  );
  const taskFrom: Position = onb
    ? onboardingStart(student)
    : (win[0]?.from ?? newPart.from);

  return buildSlice(
    'hifz',
    direction,
    taskFrom,
    newTo,
    newPart.from,
    newTo,
    onb ? 'onboarding' : 'rolling',
    amount,
    unit,
    nextStart,
  );
}

/** خطة اليوم لطالب في وضع (حفظ/مراجعة) — أو null إن لا مقدار. */
export function planFor(student: Student, mode: PlanMode): DailyPlan | null {
  const base = sliceFrom(student, mode, currentPositionOf(student, mode));
  if (!base) return null;
  return {
    ...base,
    direction: mode === 'hifz'
      ? (student.hifzDirection ?? 'nas-to-baqarah')
      : (student.murajaahDirection ?? 'nas-to-baqarah'),
    paused: mode === 'hifz' && !!student.hifzPaused,
  };
}

/** الموضع التالي بعد إتمام مهمّة اليوم (يُحفظ كموضع جارٍ). */
export function nextPositionAfter(student: Student, mode: PlanMode): Position | null {
  const plan = planFor(student, mode);
  return plan?.nextStart ?? null;
}

/** نافذة الربط بعد إتمام مقطع اليوم: نُضيف ونُبقي الأحدث مقطعين فقط. */
export function nextHifzWindow(current: Portion[] | undefined, portion: Portion): Portion[] {
  return [...(current ?? []), portion].slice(-2);
}

/**
 * **قلب إعادة الجدولة التكيّفية**: الموضع الذي يبدأ منه الطالب بعد أن سُمِع فعلاً
 * حتى `to` — لا بعد المقدار المخطَّط. فإن سُمِع ٤ أوجه من أصل ٥، فالغد يبدأ من
 * الوجه الخامس، ولا يُفقَد شيء.
 */
export function positionAfterRecited(
  to: Position,
  direction: ProgressDirection,
  bounds?: WalkBounds,
): Position | null {
  const idx = globalIndex(to.surah, to.ayah);
  if (idx === null) return null;
  return nextPosition(to, direction, bounds);
}

/** أقرب الموضعين في اتجاه السير (الأوّل سيراً) — لتقييد تقدّم الموضع بالمقطع الجديد. */
export function earlierInDirection(
  a: Position,
  b: Position,
  direction: ProgressDirection,
): Position {
  return furtherPosition(a, b, direction) === a ? b : a;
}

// ─────────────────────────────────────────────────────────────────────────────
// حالةُ اليوم لكل مادّة — تُغذّي شارات الإنجاز على بطاقة الطالب.
// ─────────────────────────────────────────────────────────────────────────────
export type DayMark = 'none' | 'done' | 'not_recited';

export interface DayStatuses {
  hifz: DayMark;
  hifzScore?: number;
  murajaah: DayMark;
  murajaahScore?: number;
}

/** يشتقّ حالة (حفظ/مراجعة) من جلسة اليوم — ويدعم الصفوف القديمة (result فقط). */
export function dayStatuses(session: Session | null | undefined): DayStatuses {
  if (!session) return { hifz: 'none', murajaah: 'none' };
  const legacyNotRecited =
    session.result === 'not_recited' && !session.hifzResult && !session.murajaahResult;
  const hifz: DayMark =
    session.hifzResult === 'recited'
      ? 'done'
      : session.hifzResult === 'not_recited'
        ? 'not_recited'
        : legacyNotRecited
          ? 'not_recited'
          : (session.hifzLines ?? 0) > 0
            ? 'done'
            : 'none';
  const murajaah: DayMark =
    session.murajaahResult === 'recited'
      ? 'done'
      : session.murajaahResult === 'not_recited'
        ? 'not_recited'
        : session.result === 'recited' && (session.murajaahPages ?? 0) > 0
          ? 'done'
          : 'none';
  return {
    hifz,
    hifzScore: session.hifzScore,
    murajaah,
    murajaahScore: session.murajaahScore,
  };
}
