// src/components/StudentCard.tsx
import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { BookOpen, Check, Mail, Pencil, XCircle } from 'lucide-react';
import RecitationSheet from './RecitationSheet';
import DailyReportModal from './DailyReportModal';
import { CalendarDays } from 'lucide-react';
import { navigate, circleHash, recitationHash, mushafHash, planHash } from '../utils/nav';
import { isoDay } from '../db';
import type { Student, StudentStatus, RingPeriod } from '../db/schema';
import type { DailyPlan, DayStatuses, DayMark } from '../utils/dailyPlan';
import { isZeroScore, scoreBand, scoreColor, scoreText } from '../utils/scoreColor';
import type { ScoreBand } from '../utils/scoreColor';

/** نقطة الحالة = نفس دوائر الحضور (🟢🟡🔴) التي يستعملها التطبيق — بنفس مظهرها
 *  اللامع المجسَّم، مصغَّرةً لتُوضع في حبّة الدرجة. والدرجة تختار دائرتها بالفئة. */
const BAND_DOT: Record<ScoreBand, string> = {
  green: '🟢',
  amber: '🟡',
  orange: '🟠',
  red: '🔴',
};

/** شارة إنجاز مادّة واحدة في اليوم — حبّةٌ واحدة: النصّ/الدرجة يميناً والنقطة يساراً.
 *  الحبّة كلها بلون الدرجة (تعبئة خفيفة + إطار + نصّ)، والنقطة دائرةٌ ملوّنة على
 *  هيئة دوائر الحضور في التطبيق.
 *  وترتبط بالحضور: غائب/مستأذن ⇒ النصّ «غائب»/«مستأذن» بالحبّة الرمادية نفسها
 *  (لا حمراء) — فالجلسة لم تُؤدَّ لغيابٍ لا لتقصير. */
function DayStatusBadge({
  subject,
  mark,
  score,
  attendance,
  suspended = false,
}: {
  subject: string;
  mark: DayMark;
  score?: number;
  attendance: StudentStatus;
  /** المادة موقوفة أصلاً (مثل المراجعة في مرحلة التأسيس) ⇒ شارة رمادية صريحة */
  suspended?: boolean;
}) {
  const failed = !suspended && (mark === 'not_recited' || (mark === 'done' && isZeroScore(score)));
  /**
   * الحبّة تُعبّر عن **التسميع** لا عن الحضور: «متأخر» حضورٌ لا تقييمُ تسميع،
   * فيبقى نصّها «لم يُسمَّع» حتى تُسجَّل الجلسة فعلاً. والمادّة تُغلَق لغيابٍ أو
   * استئذانٍ فقط — أمّا المتأخر فيُسمَّع له متى وصل.
   */
  const unrecitedLabel =
    attendance === 'absent' ? 'غائب' : attendance === 'excused' ? 'مستأذن' : 'لم يُسمَّع';
  const label =
    suspended
      ? 'متوقفة'
      : mark === 'none'
        ? unrecitedLabel
      : failed
        ? 'لم يحفظ'
        : mark === 'done'
          ? scoreText(score)
          : 'تمّ ✓';
  const accent = suspended || mark === 'none' ? null : scoreColor(failed ? 0 : (score ?? 20));

  return (
    <span
      data-status={subject}
      title={`${subject}: ${label}`}
      style={accent ? ({ '--score': accent } as CSSProperties) : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-extrabold leading-none ${
        accent
          ? 'chip-score'
          : 'border-stone-300/70 bg-stone-100/80 text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-amber-100/55'
      }`}
    >
      {/* النصّ/الدرجة أولاً (أقصى اليمين في RTL) ثم النقطة في أقصى اليسار */}
      {label}
      <span aria-hidden data-dot className="text-[11px] leading-none">
        {mark === 'none' ? '⚪' : BAND_DOT[scoreBand(failed ? 0 : (score ?? 20))]}
      </span>
    </span>
  );
}

// ---------- Attendance badge definitions (Arabic, obvious) ----------
interface BadgeDef {
  key: StudentStatus;
  label: string;
  emoji: string;
  active: string;
  inactive: string;
}

// الحضور = أربعة أوضاع في صفٍّ واحد: 🟢 حاضر | 🟠 متأخر | 🟡 مستأذن | 🔴 غائب
// («لم يحفظ» ليست حالة حضور — لها زرها المستقل أسفل [بدء التسميع]).
// والضغط على الحالة المختارة **يُلغيها** فيعود الطالب غير مُعلَّم (null).
const BADGES: BadgeDef[] = [
  {
    key: 'present',
    label: 'حاضر',
    emoji: '🟢',
    // green-700 لا 600: النصّ الأبيض عليه يبلغ 4.5:1 (كان 3.2:1)
    active: 'bg-green-700 text-white ring-green-700/40 shadow-md shadow-green-700/30 dark:bg-green-700 dark:text-white',
    inactive: 'bg-green-50 text-green-700 dark:bg-white/5 dark:text-green-300',
  },
  {
    key: 'late',
    label: 'متأخر',
    emoji: '🟠',
    // orange-700 لا 600: النصّ الأبيض عليه يبلغ ≈4.6:1 (AA)
    active:
      'bg-orange-700 text-white ring-orange-700/40 shadow-md shadow-orange-700/30 dark:bg-orange-600 dark:text-white',
    inactive: 'bg-orange-50 text-orange-700 dark:bg-white/5 dark:text-orange-300',
  },
  {
    key: 'excused',
    label: 'مستأذن',
    emoji: '🟡',
    active: 'bg-amber-500 text-amber-950 ring-amber-500/40 shadow-md shadow-amber-500/30 dark:bg-amber-400 dark:text-amber-950',
    inactive: 'bg-amber-50 text-amber-700 dark:bg-white/5 dark:text-amber-300',
  },
  {
    key: 'absent',
    label: 'غائب',
    emoji: '🔴',
    // red-700 لا 600: النصّ الأبيض عليه يبلغ 5.9:1 (كان 4.4:1)
    active: 'bg-red-700 text-white ring-red-700/40 shadow-md shadow-red-700/30 dark:bg-red-700 dark:text-white',
    inactive: 'bg-red-50 text-red-700 dark:bg-white/5 dark:text-red-300',
  },
];

interface Props {
  student: Student;
  ringPeriod?: RingPeriod;
  autoOpenRecitation?: boolean;
  onRecitationStateChange?: (open: boolean) => void;
  /** null = إلغاء الحضور (الضغط على الحالة المختارة يتراجع عنها) */
  onUpdateStatus: (status: StudentStatus | null) => void;
  onEdit: () => void;
  /** هل سُجّلت نتيجة اليوم كـ«لم يحفظ»؟ */
  notMemorizedToday?: boolean;
  onToggleNotMemorized?: () => void;
  /** حضور التاريخ المختار (من جدول attendance) — null = غير مُعلَّم */
  dayStatus?: StudentStatus | null;
  /** التاريخ المختار — تُسجَّل الجلسة عليه */
  date?: string;
  /** مهمّة اليوم المحسوبة من محرّك التدرّج */
  hifzPlan?: DailyPlan | null;
  murajaahPlan?: DailyPlan | null;
  /** حالة إنجاز اليوم (حفظ/مراجعة) للتاريخ المختار */
  dayMarks?: DayStatuses;
  /** اسم الحلقة — يظهر في ترويسة التقرير اليومي */
  ringName?: string;
  /** يومُ إجازةٍ والتسميع غير مُتاح ⇒ الأزرار مقفلة (لا تسميع ولا «لم يحفظ») */
  recitationLocked?: boolean;
  /** يومُ إجازةٍ **مُتاح** فيه التسميع: يُسمع ويُسجَّل بلا تقديم الموضع الجاري */
  recitationOffDay?: boolean;
  /** مرحلة تأسيس جزء عمّ ⇒ المراجعة موقوفة تماماً (تُشار إليها صراحةً) */
  murajaahSuspended?: boolean;
}

export default function StudentCard({
  student,
  ringPeriod = 'Fajr',
  autoOpenRecitation = false,
  onRecitationStateChange,
  onUpdateStatus,
  onEdit,
  notMemorizedToday = false,
  onToggleNotMemorized,
  dayStatus,
  date,
  hifzPlan,
  murajaahPlan,
  dayMarks,
  ringName = '',
  recitationLocked = false,
  recitationOffDay = false,
  murajaahSuspended = false,
}: Props) {
  const [isRecitationOpen, setIsRecitationOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // ── حضور التاريخ المختار (أو حالة الطالب المحفوظة) ──
  // الغياب والاستئذان يُقفلان أزرار التسميع: لا بدء تسميع ولا تسجيل «لم يحفظ»
  // لطالبٍ ليس حاضراً. وعند الرجوع إلى «حاضر» تعود الأزرار للعمل فوراً (حالة).
  const marks = { hifz: dayMarks?.hifz ?? 'none', murajaah: dayMarks?.murajaah ?? 'none' } as const;
  /** صفُّ جلسةٍ مسجَّلٌ لليوم (تسميعٌ بدرجات أو تسجيل «لم يحفظ») */
  const recorded = marks.hifz !== 'none' || marks.murajaah !== 'none';
  /** تسميعٌ فعليّ بدرجات */
  const recited = marks.hifz === 'done' || marks.murajaah === 'done';
  /** اكتمل الجزآن (تسميعًا أو تسجيل «لم يحفظ») */
  const settled = marks.hifz !== 'none' && marks.murajaah !== 'none';

  /**
   * ترابط التسميع ↔ الحضور: من سُجّل له تسميعٌ اليوم لا يُعقل أن يكون غائباً أو
   * مستأذناً ⇒ يُثبَّت الحضور على «حاضر» ويُقفل الزرّان الآخران، ويزول القفل
   * تلقائياً إذا مُسح التسجيل (فالحالة مشتقّة لا مخزّنة).
   */
  const stored: StudentStatus | null = dayStatus ?? student.status;
  const attendance: StudentStatus = recorded ? 'present' : (stored ?? 'not_prepared');
  /** لا حضورَ مُعلَّماً أصلاً ⇒ لا حبّة مختارة (حالة «غير مُعلَّم») */
  const notPresent = attendance === 'absent' || attendance === 'excused';
  /** القفل يشمل: غياب/استئذان، ويوم إجازةٍ غير مُتاح فيه التسميع */
  const recitationBlocked = notPresent || recitationLocked;
  const blockedReason =
    attendance === 'absent'
      ? 'الطالب غائب — لا يمكن بدء التسميع أو تسجيل «لم يحفظ»'
      : attendance === 'excused'
        ? 'الطالب مستأذن — لا يمكن بدء التسميع أو تسجيل «لم يحفظ»'
        : recitationLocked
          ? 'يوم إجازة — التسميع غير مُتاح. يمكن تفعيله من: تعديل بيانات الحلقة ← إتاحة التسميع في أيام الإجازة'
          : '';

  // تثبيت القفل في البيانات أيضاً (لا في العرض وحده) — مرةً واحدة في كل دورة
  const lockWritten = useRef(false);
  useEffect(() => {
    if (!recorded) {
      lockWritten.current = false;
      return;
    }
    if (lockWritten.current) return;
    lockWritten.current = true;
    if (stored !== 'present') onUpdateStatus('present');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded, stored]);

  // Restore-from-hash: auto-open recitation for this student once (after refresh).
  useEffect(() => {
    if (autoOpenRecitation && student.id != null) {
      setIsRecitationOpen(true);
      onRecitationStateChange?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenRecitation]);

  const openRecitation = () => {
    setIsRecitationOpen(true);
    onRecitationStateChange?.(true);
    if (student.id != null) navigate(recitationHash(student.ringId, student.id));
  };
  const closeRecitation = () => {
    setIsRecitationOpen(false);
    onRecitationStateChange?.(false);
    navigate(circleHash(student.ringId));
  };

  return (
    <div className="glass press flex flex-col gap-4 p-5">
      {/* Header: name + plan tags */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-extrabold leading-tight text-[#2D1F17] dark:text-[#F5EBE1]">
            {student.name}
          </h3>
          <p className="mt-0.5 text-sm font-medium text-[#7a6450] dark:text-amber-100/60">
            {student.level || '—'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setReportOpen(true)}
            aria-label={`إرسال تقرير ${student.name}`}
            title="تقرير اليوم — رسالة لولي الأمر أو تقرير للإدارة"
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-bold text-[#7a6450] transition-colors hover:bg-[#B8860B]/15 hover:text-[#8a6508] dark:bg-white/5 dark:text-amber-100/70 dark:hover:bg-amber-400/15 dark:hover:text-amber-200"
          >
            <Mail className="h-3.5 w-3.5" />
            رسالة
          </button>
          <button
            onClick={onEdit}
            aria-label={`تعديل بيانات ${student.name}`}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-bold text-[#7a6450] transition-colors hover:bg-[#B8860B]/15 hover:text-[#8a6508] dark:bg-white/5 dark:text-amber-100/70 dark:hover:bg-amber-400/15 dark:hover:text-amber-200"
          >
            <Pencil className="h-3.5 w-3.5" />
            تعديل
          </button>
        </div>
      </div>

      {/* «خطة الطالب» — أسفل صفّ (تعديل/رسالة) تماماً كما هو المطلوب:
          يفتح الخطّة الأسبوعية بمقاطعها الحقيقية (سورة/آية) لهذا الطالب. */}
      <button
        onClick={() => {
          if (student.id != null) navigate(planHash(student.ringId, student.id));
        }}
        aria-label={`خطة الطالب ${student.name}`}
        title="الخطّة الأسبوعية: مقاطع الحفظ والمراجعة لكل يوم"
        className="press flex w-full items-center justify-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2.5 text-[13px] font-extrabold text-[#5A4636] ring-1 ring-inset ring-black/5 transition-colors hover:bg-[#B8860B]/12 hover:text-[#8a6508] dark:bg-white/5 dark:text-amber-100/80 dark:ring-white/10 dark:hover:bg-amber-400/15 dark:hover:text-amber-200"
      >
        <CalendarDays className="h-4 w-4" />
        خطة الطالب
      </button>

      {/* ── سطرٌ لكل مادّة: المقرَّر يميناً، وحبّة حالته يساراً ──
          (المقرَّر بلا أرقام أسطر/أوجه — تلك مكانها صفحة التسميع) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {student.hifzPaused ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-stone-200 px-3 py-1 text-xs font-bold text-stone-700 ring-1 ring-inset ring-stone-300 dark:bg-white/10 dark:text-amber-100/70 dark:ring-white/15">
              ⏸ حفظ متوقف: {student.hifzPauseDays ?? 0} يوم · مراجعة فقط
            </span>
          ) : hifzPlan ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/30">
              📖 حفظ: {hifzPlan.range}
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500 ring-1 ring-inset ring-stone-200 dark:bg-white/5 dark:text-amber-100/50 dark:ring-white/10">
              📖 حفظ
            </span>
          )}
          <DayStatusBadge
            subject="حفظ"
            mark={dayMarks?.hifz ?? 'none'}
            score={dayMarks?.hifzScore}
            attendance={attendance}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          {murajaahSuspended ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500 ring-1 ring-inset ring-stone-200 dark:bg-white/5 dark:text-amber-100/50 dark:ring-white/10">
              🔄 مراجعة: متوقفة — تأسيس جزء عمّ
            </span>
          ) : murajaahPlan ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/20 dark:text-orange-200 dark:ring-orange-500/30">
              🔄 مراجعة: {murajaahPlan.range}
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500 ring-1 ring-inset ring-stone-200 dark:bg-white/5 dark:text-amber-100/50 dark:ring-white/10">
              🔄 مراجعة
            </span>
          )}
          <DayStatusBadge
            subject="مراجعة"
            mark={dayMarks?.murajaah ?? 'none'}
            score={dayMarks?.murajaahScore}
            attendance={attendance}
            suspended={murajaahSuspended}
          />
        </div>
      </div>

      {/* Attendance badges — the only way to mark attendance */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#6B5B4A] dark:text-amber-100/60">
          حالة الحضور
        </p>
        {/* 4 حالات حضور في **صفٍّ واحد** بأربعة أعمدة متساوية، والضغط على
            الحالة المختارة يُلغيها (تراجعٌ فوريّ عن الضغطة الخاطئة).
            وبعد تسجيل التسميع يُقفل الحضور على «حاضر» فلا يقبل التغيير. */}
        <div className="grid grid-cols-4 gap-1">
          {BADGES.map((b) => {
            const selected = attendance === b.key;
            const lockedOut = recorded && b.key !== 'present';
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => onUpdateStatus(selected ? null : b.key)}
                aria-pressed={selected}
                disabled={recorded}
                aria-disabled={recorded}
                title={
                  lockedOut
                    ? 'لا يمكن اختياره — الحضور مثبَّت على «حاضر» بعد تسجيل التسميع'
                    : selected
                      ? 'اضغط لإلغاء الحضور (غير مُعلَّم)'
                      : undefined
                }
                className={`press inline-flex items-center justify-center gap-1 rounded-full px-1 py-2 text-[12px] font-bold ring-1 ring-inset transition-all duration-200 ${
                  selected ? b.active : b.inactive
                } ${lockedOut ? 'pointer-events-none cursor-not-allowed opacity-40' : ''}`}
              >
                <span aria-hidden>{b.emoji}</span>
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Prominent recitation button — never hidden in a menu.
          يُعطَّل تماماً إذا كان الطالب غائباً أو مستأذناً، ويتغيّر نصّه بعد
          تسجيل التسميع ليعرف المعلّم أنّ الجلسة أُنجزت (ويمكن تعديلها). */}
      <button
        onClick={openRecitation}
        disabled={recitationBlocked}
        aria-disabled={recitationBlocked}
        title={recitationBlocked ? blockedReason : undefined}
        className={`press flex w-full items-center justify-center gap-2 rounded-2xl btn-accent px-4 py-3 text-base font-extrabold shadow-lg transition-all duration-200 active:scale-[0.98] hover:brightness-110 ${
          recitationBlocked ? 'pointer-events-none cursor-not-allowed opacity-40 shadow-none' : ''
        }`}
      >
        {settled ? (
          <>
            <Check className="h-5 w-5" />
            تم التسميع
          </>
        ) : recited ? (
          <>
            <Pencil className="h-5 w-5" />
            تعديل التسميع
          </>
        ) : (
          <>
            <BookOpen className="h-5 w-5" />
            بدء التسميع
          </>
        )}
      </button>

      {/* «لم يحفظ» — يعني أنّ الطالب لم يُحضّر منهج اليوم إطلاقاً، فتُعلَّم
          المادّتان معاً في Dexie (حفظ ⛔ + مراجعة ⛔) بلا المرور بالمصحف.
          الضغطة الثانية تتراجع عن التسجيل (وتحذف صفّ اليوم إن كان فارغاً).
          ويُعطَّل أيضاً للغائب والمستأذن. */}
      <button
        onClick={onToggleNotMemorized}
        disabled={recitationBlocked}
        aria-pressed={notMemorizedToday}
        aria-disabled={recitationBlocked}
        title={
          recitationBlocked
            ? blockedReason
            : notMemorizedToday
              ? 'اضغط للتراجع عن «لم يحفظ» (الحفظ والمراجعة)'
              : 'الطالب لم يُحضّر شيئاً اليوم — تُعلَّم الحفظ والمراجعة معاً'
        }
        className={`press flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-extrabold ring-1 ring-inset transition-all duration-200 ${
          notMemorizedToday
            ? 'bg-rose-600 text-white ring-rose-500/50 shadow-md shadow-rose-800/30'
            : 'bg-rose-500/[0.07] text-rose-700 ring-rose-500/25 hover:bg-rose-500/15 dark:bg-rose-500/10 dark:text-rose-300'
        } ${recitationBlocked ? 'pointer-events-none cursor-not-allowed opacity-40' : ''}`}
      >
        <XCircle className="h-5 w-5 shrink-0" />
        {notMemorizedToday ? 'مسجّل: لم يحفظ ✓' : 'لم يحفظ اليوم'}
      </button>

      {/* NOTE: deletion no longer lives on the card — it moved inside the Edit
          modal, behind an explicit confirmation (وسجلاته). */}

      <RecitationSheet
        isOpen={isRecitationOpen}
        onClose={closeRecitation}
        studentName={student.name}
        level={student.level}
        studentId={student.id}
        ringPeriod={ringPeriod}
        hifzTarget={student.hifzTarget}
        murajaahTarget={student.murajaahTarget}
        date={date}
        keepPosition={recitationOffDay}
        onOpenMushaf={() => {
          if (student.id != null) navigate(mushafHash(student.ringId, student.id));
        }}
      />

      {/* التقرير اليومي / المراسلة — رسالة ولي الأمر أو تقرير الإدارة */}
      <DailyReportModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        data={{
          student,
          ringName: ringName || 'الحلقة',
          date: date ?? isoDay(),
          attendance,
          marks: dayMarks ?? { hifz: 'none', murajaah: 'none' },
          hifzPlan: hifzPlan ?? null,
          murajaahPlan: murajaahPlan ?? null,
        }}
      />
    </div>
  );
}
