// src/components/RecitationSheet.tsx
// TRUE full-screen overlay for recitation in «مُدَبِّر».
// - Covers the entire circle page (fixed inset-0 z-50) and disables background scroll.
// - Sticky header: student name + grade · segmented [حفظ]/[مراجعة] · [📋 خطة الطالب] + [✕ إغلاق].
// - Verse-selection re-laid out as a clean grid (surah full-width; من/إلى steppers in 2 cols).
// - Floating bottom action bar: [التالي: مراجعة] + [✅ تسليم الحفظ] → saves a real Dexie session.
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListChecks, X, XCircle } from 'lucide-react';
import {
  db,
  getDaySession,
  isoDay,
  markNotMemorized,
  saveRecitationPart,
} from '../db';
import type { RingPeriod, Student, Session } from '../db/schema';
import { sessionGet, sessionSet, sessionRemove } from '../utils/session';
import {
  DIRECTION_LABEL,
  allSurahs,
  type Position,
  ayahCountOf,
  loadCurriculum,
  surahShort,
} from '../utils/progression';
import {
  dayStatuses,
  earlierInDirection,
  onboardingActive,
  murajaahBoundsOf,
  nextHifzWindow,
  nextPositionAfter,
  planFor,
  positionAfterRecited,
} from '../utils/dailyPlan';
import type { DayMark } from '../utils/dailyPlan';
import { isZeroScore, scoreColor, scoreText } from '../utils/scoreColor';
import { navigate, planHash } from '../utils/nav';

type Mode = 'hifz' | 'murajaah';

/** Shape persisted to sessionStorage so an accidental refresh (or HMR) keeps
 *  the teacher on the exact same recitation screen with mistakes intact. */
interface SavedRecite {
  mode: Mode;
  surah: string;
  startVerse: number;
  endVerse: number;
  /** أخطاء كل مادّة على حدة (مستقلّة تماماً: حفظ ≠ مراجعة) */
  errors?: { hifz: number; murajaah: number };
  /** توافقٌ مع مسودّةٍ قديمة كانت تحمل رقماً واحداً للمادّتين */
  mistakes?: number;
}

/** حصر عدد الأخطاء في ٠…٢٠ (الدرجة = ٢٠ − الأخطاء). */
const clampErr = (n: number): number =>
  Math.max(0, Math.min(20, Math.round(Number.isFinite(n) ? n : 0)));

/** الأخطاء المسجَّلة لمادّةٍ في صفّ اليوم (٠ إن لم تُسجَّل بدرجة). */
function recordedErrors(s: Session | null, m: Mode): number {
  if (!s) return 0;
  const score = m === 'hifz' ? s.hifzScore : s.murajaahScore;
  const result = m === 'hifz' ? s.hifzResult : s.murajaahResult;
  if (result !== 'recited' || score === undefined) return 0;
  return clampErr(20 - score);
}

const endVerseSnippet: Record<string, string> = {
  النور: 'حتى قوله تعالى: ﴿ ٱللَّهُ نُورُ ٱلسَّمَـٰوَٰتِ وَٱلْأَرْضِ ﴾',
  الفرقان: 'حتى قوله تعالى: ﴿ تَبَارَكَ ٱلَّذِي نَزَّلَ ٱلْفُرْقَانَ عَلَىٰ عَبْدِهِۦ ﴾',
  الشعراء: 'حتى قوله تعالى: ﴿ طسٓمٓ ﴾',
  النمل: 'حتى قوله تعالى: ﴿ طسٓ تِلْكَ ءَايَـٰتُ ٱلْقُرْءَانِ ﴾',
  القصص: 'حتى قوله تعالى: ﴿ طسٓمٓ ﴾',
};

const PERIOD_LABEL: Record<RingPeriod, string> = {
  Fajr: 'الفجر',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء',
};

/** شارة حالة مادّة واحدة (حفظ / مراجعة) في يوم الجلسة.
 *  نفس تدريج الألوان المتّصل المستخدم على البطاقة (أخضر ⇒ برتقاليّ ⇒ أحمر)،
 *  والدرجة صفر تُعرض «لم يحفظ» ولا تُعرض كرقم. */
function PartStatus({ subject, mark, score }: { subject: string; mark: DayMark; score?: number }) {
  if (mark === 'done') {
    if (isZeroScore(score)) {
      return (
        <span className="inline-flex items-center justify-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-extrabold text-white">
          ⛔ {subject}: لم يحفظ
        </span>
      );
    }
    return (
      <span
        style={{ backgroundColor: scoreColor(score ?? 20) }}
        className="inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold text-white ring-1 ring-inset ring-black/10"
      >
        🟢 {subject}: {scoreText(score)}
      </span>
    );
  }
  if (mark === 'not_recited') {
    return (
      <span className="inline-flex items-center justify-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-extrabold text-white">
        ⛔ {subject}: لم يحفظ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center gap-1 rounded-full bg-amber-100/10 px-2.5 py-1 text-[11px] font-bold text-amber-100/50">
      ⚪ {subject}: لم يُسمّع
    </span>
  );
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  studentName: string;
  level?: string;
  studentId?: number;
  ringPeriod?: RingPeriod;
  hifzTarget?: number;
  murajaahTarget?: number;
  /** التاريخ المختار في لوحة الحلقة (yyyy-mm-dd) — تُسجَّل الجلسة عليه */
  date?: string;
  /** لا تُقدّم الموضع الجاري (يوم إجازة أُذن فيه بالتسميع) — الخطّة لا تزحف */
  keepPosition?: boolean;
  /** Navigate to the dedicated full-screen Mushaf view. */
  onOpenMushaf?: () => void;
}

export default function RecitationSheet({
  isOpen,
  onClose,
  studentName,
  level = '',
  studentId,
  ringPeriod = 'Fajr',
  hifzTarget = 25,
  murajaahTarget = 25,
  date,
  onOpenMushaf,
  keepPosition = false,
}: Props) {
  // Restore the exact recitation screen after an accidental reload/HMR:
  // the per-student key matches the hash route #/circle/:id/recitation/:sid.
  const storageKey = studentId !== undefined ? `recite:${studentId}` : null;
  const savedRef = useRef<SavedRecite | null>(null);
  if (savedRef.current === null && storageKey) {
    savedRef.current = sessionGet<SavedRecite | null>(storageKey, null);
  }
  const saved = savedRef.current;

  const [mode, setMode] = useState<Mode>(saved?.mode ?? 'hifz');
  const [surah, setSurah] = useState(saved?.surah ?? 'النور');
  const [startVerse, setStartVerse] = useState(saved?.startVerse ?? 28);
  const [endVerse, setEndVerse] = useState(saved?.endVerse ?? 31);
  // ── أخطاء كل مادّة في متغيّرٍ مستقلّ ──────────────────────────────────────
  // التبديل بين «حفظ» و«مراجعة» لا يمسّ عدّاد الآخر إطلاقاً، ولكلٍّ درجته
  // المحسوبة من أخطائه هو (الدرجة = ٢٠ − أخطاء تلك المادّة).
  const [mis, setMis] = useState<{ hifz: number; murajaah: number }>(() => {
    if (saved?.errors) return { hifz: clampErr(saved.errors.hifz), murajaah: clampErr(saved.errors.murajaah) };
    if (typeof saved?.mistakes === 'number') {
      // مسودّة قديمة: الرقم الواحد يخصّ المادّة التي كانت مفتوحة
      return saved.mode === 'murajaah'
        ? { hifz: 0, murajaah: clampErr(saved.mistakes) }
        : { hifz: clampErr(saved.mistakes), murajaah: 0 };
    }
    return { hifz: 0, murajaah: 0 };
  });
  /** أخطاء المادّة المعروضة الآن، وكاتبٌ يمسّها وحدها. */
  const mistakes = mis[mode];
  const setMistakes = (v: number | ((p: number) => number)) =>
    setMis((p) => ({
      ...p,
      [mode]: clampErr(typeof v === 'function' ? v(p[mode]) : v),
    }));
  const containerRef = useRef<HTMLDivElement>(null);

  // ── مصدر الحقيقة: محرّك التدرّج + موضع الطالب الجاري في Dexie ──
  // هذا هو ما يمنع انفصال ورقة التسميع عن إعدادات الطالب في النافذة.
  const [student, setStudent] = useState<Student | null>(null);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false); // هل عدّل المعلّم يدوياً؟

  useEffect(() => {
    if (!isOpen) return;
    if (studentId === undefined) {
      setReady(true);
      return;
    }
    let alive = true;
    Promise.all([loadCurriculum(), db.student.get(studentId)])
      .then(([, st]) => {
        if (!alive) return;
        setStudent((st as Student) ?? null);
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, studentId]);

  // التاريخ المختار في لوحة الحلقة (أو اليوم) — كل السجلات تُفتح عليه.
  const day = date ?? isoDay();
  const isToday = day === isoDay();

  const dailyPlan = ready && student ? planFor(student, mode) : null;
  const otherMode: Mode = mode === 'hifz' ? 'murajaah' : 'hifz';
  // هل للوضع الآخر مهمّةٌ فعلاً؟ ⇒ إن لم تكن، يكفي تسليم الوضع الحالي.
  const otherPlanExists = ready && student ? planFor(student, otherMode) !== null : true;

  // ── حالة اليوم في السجل: أي المادّتين انتهت؟ (يحكم أزرار الورقة) ──
  const [daySession, setDaySession] = useState<Session | null>(null);
  const [dayLoaded, setDayLoaded] = useState(false);
  const refreshDaySession = async () => {
    if (studentId === undefined) return;
    try {
      setDaySession((await getDaySession(studentId, day)) ?? null);
      setDayLoaded(true);
    } catch {
      /* لا شيء */
    }
  };
  useEffect(() => {
    if (!isOpen || studentId === undefined) return;
    let alive = true;
    getDaySession(studentId, day)
      .then((s) => {
        if (alive) {
          setDaySession(s ?? null);
          setDayLoaded(true);
        }
      })
      .catch(() => alive && setDayLoaded(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, studentId, day]);

  // ── تعديل درجةٍ مسجّلة: نُحمّل أخطاء اليوم المسجّلة مرّة واحدة عند الفتح ──
  // فإن أدخل المعلّم درجةً خطأً صار بإمكانه فتح الورقة وتصحيح الأخطاء ثم
  // «تحديث الدرجة» — تُحدَّث نفس الصفّ في Dexie. وإن كانت هناك مسودّةُ تحريرٍ
  // معلّقة (المعلّم عدّل ولم يُسلّم) فلا نُلغي تعديله.
  const seededRef = useRef<boolean>(!!saved);
  useEffect(() => {
    if (!dayLoaded || seededRef.current) return;
    seededRef.current = true;
    setMis({
      hifz: recordedErrors(daySession, 'hifz'),
      murajaah: recordedErrors(daySession, 'murajaah'),
    });
  }, [dayLoaded, daySession]);

  const marks = dayStatuses(daySession);
  const hifzRecorded = marks.hifz !== 'none';
  const murajaahRecorded = marks.murajaah !== 'none';
  const currentRecorded = mode === 'hifz' ? hifzRecorded : murajaahRecorded;
  const otherRecorded = mode === 'hifz' ? murajaahRecorded : hifzRecorded;
  /** الوضع الآخر مسجّل أو لا مهمّةَ له ⇒ انتهى تسميع اليوم فعلاً. */
  const otherSettled = otherRecorded || !otherPlanExists;
  const bothSettled = currentRecorded && otherSettled;
  /** الأخطاء المسجَّلة لكل مادّة الآن — لمعرفة هل المعلّم عدّل شيئاً. */
  const recordedMis = {
    hifz: recordedErrors(daySession, 'hifz'),
    murajaah: recordedErrors(daySession, 'murajaah'),
  };
  /** المادة الحالية مسجّلة وأخطاؤها تغيّرت ⇒ الزر يصير «تحديث الدرجة». */
  const gradeDirty = currentRecorded && mis[mode] !== recordedMis[mode];
  /** آخر مادة سُلّمت — لإظهار تأكيد صغير للمعلّم. */
  const [justSaved, setJustSaved] = useState<{ mode: Mode; updated: boolean } | null>(null);

  const MODE_LABEL: Record<Mode, string> = { hifz: 'الحفظ', murajaah: 'المراجعة' };
  const MODE_SHORT: Record<Mode, string> = { hifz: 'حفظ', murajaah: 'مراجعة' };
  /** المادة الحالية مُعلَّمة «لم يحفظ»؟ */
  const currentIsFailed = (mode === 'hifz' ? marks.hifz : marks.murajaah) === 'not_recited';
  const planKey = dailyPlan
    ? `${dailyPlan.mode}:${dailyPlan.from.surah}:${dailyPlan.from.ayah}:${dailyPlan.to.surah}:${dailyPlan.to.ayah}`
    : '';

  // مزامنة الحقول مع المهمّة المحسوبة (وعند تبديل الوضع حفظ/مراجعة).
  useEffect(() => {
    if (!dailyPlan) return;
    setSurah(surahShort(dailyPlan.from.surah));
    setStartVerse(dailyPlan.from.ayah);
    setEndVerse(dailyPlan.to.ayah);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  // Persist the whole session whenever anything changes (only while open).
  useEffect(() => {
    if (!isOpen || !storageKey) return;
    sessionSet(storageKey, {
      mode,
      surah,
      startVerse,
      endVerse,
      errors: mis,
    } satisfies SavedRecite);
  }, [isOpen, storageKey, mode, surah, startVerse, endVerse, mis]);

  // When the recitation is fully submitted, clear the saved session and reset
  // the form so the NEXT session for the same student starts fresh.
  const resetSession = () => {
    if (storageKey) {
      sessionRemove(storageKey);
      // also clear the mushaf highlights snapshot for this student
      sessionRemove(`quran:${storageKey.slice('recite:'.length)}:page`);
      sessionRemove(`quran:${storageKey.slice('recite:'.length)}:states`);
    }
    setMode('hifz');
    setSurah('النور');
    setStartVerse(28);
    setEndVerse(31);
    setMis({ hifz: 0, murajaah: 0 });
    setJustSaved(null);
  };

  // Screen Wake Lock while the recitation is open
  useEffect(() => {
    let wakeLock: any = null;
    if ('wakeLock' in navigator && isOpen) {
      (async () => {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch {
          /* not critical */
        }
      })();
    }
    return () => {
      if (wakeLock) wakeLock.release().then(() => (wakeLock = null));
    };
  }, [isOpen]);

  // Lock background scrolling while the overlay is open
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const score = Math.max(0, 20 - mistakes);
  const verseCount = Math.max(1, endVerse - startVerse + 1);
  const assignmentLabel = `${surah} ${startVerse} - ${surah} ${endVerse}`;
  const target =
    mode === 'hifz'
      ? `${Math.min(verseCount, hifzTarget)}/${hifzTarget}`
      : `${Math.min(murajaahTarget, 5)}/${murajaahTarget}`;

  // المقدار الذي يُسجَّل في السجل بوحدة المادة نفسها: أسطرٌ للحفظ، أوجهٌ للمراجعة
  // (وهو ما تعرضه البطاقة أيضاً). وعند تعديل النطاق يدوياً نُقدّره من عدد الآيات
  // (≈ ١٥ آية للوجه) فلا تُكتب أرقامٌ بغير وحدتها.
  const amount =
    dailyPlan && !touched
      ? dailyPlan.amount
      : mode === 'hifz'
        ? verseCount
        : Math.max(1, Math.round(verseCount / 15));

  // 「📖 مصحف مرئي」 يفتح مهمّة الوضع الحالي (حفظ/مراجعة) لا غيرها.
  const openMushaf = () => {
    if (studentId !== undefined) {
      const from = dailyPlan?.from;
      if (from) {
        // إن امتدّت المهمّة إلى سورة تالية، نعرض في المصحف حتى نهاية السورة
        // الابتدائية (المصحف يعرض صفحات متتابعة، والمدى يُبنى من البداية).
        const endAyah =
          dailyPlan && dailyPlan.to.surah !== dailyPlan.from.surah
            ? ayahCountOf(dailyPlan.from.surah)
            : (dailyPlan?.to.ayah ?? endVerse);
        sessionSet(`mushaf:${studentId}`, {
          mode,
          // رقم السورة يُرسل صراحةً: أوثق من الاسم في تحديد الصفحة (الأنفال ٧١ ⇒ ١٨٦)
          surahNumber: from.surah,
          surah: surahShort(from.surah),
          startVerse: from.ayah,
          endVerse: endAyah,
          // المقدار بوحدة المادة (أسطر/أوجه) — يُسجَّل كما هو عند «تم»
          amount,
        });
      } else {
        sessionSet(`mushaf:${studentId}`, {
          mode,
          surah: surah,
          startVerse,
          endVerse,
          amount,
        });
      }
    }
    onOpenMushaf?.();
  };

  /**
   * تسليم/تحديث المادة الحالية (حفظ أو مراجعة) — يُسجَّل جزءٌ واحد في صفّ اليوم
   * نفسه، وتبقى الورقة مفتوحة ليُكمل المعلّم المادة الأخرى ثم «تسليم التسميع».
   * وإن كانت المادة مسجّلةً بالفعل فهذه **تصحيحٌ لدرجتها** (نفس الصفّ يُحدَّث).
   */
  const approvePart = async () => {
    // نُسجّل ما وافق عليه المعلّم: المهمّة المحسوبة إن لم يعدّل، وإلا تعديله.
    const wasRecorded = currentRecorded;
    const note = `${dailyPlan && !touched ? dailyPlan.label : assignmentLabel} (${
      mode === 'hifz' ? 'حفظ' : 'مراجعة'
    })`;
    /**
     * **المقطع الفعلي** الذي سُمِع — وهو ما تُبنى عليه إعادة الجدولة:
     *   from = موضع الطالب قبل الجلسة، to = آخر آية وافق عليها المعلّم.
     * لو عدّل المعلّم المقدار (٤ أوجه بدل ٥) فالتعديل هو الحقيقة، والغد يبدأ
     * من حيث انتهى فعلاً ⇒ لا يُفقَد وجهٌ ولا تزحف الخطّة.
     */
    const actualTo: Position = { surah: surahMeta?.n ?? dailyPlan?.to.surah ?? 114, ayah: endVerse };
    const actualFrom: Position = dailyPlan?.from ?? { surah: actualTo.surah, ayah: startVerse };
    if (studentId !== undefined) {
      try {
        await saveRecitationPart(studentId, day, mode, {
          amount,
          score,
          note,
          from: actualFrom,
          to: actualTo,
        });

        // ⬆ تقديم موضع الطالب الجاري مرّة واحدة عند أول تسليم لهذه المادة
        // (لا عند كل تعديل)، ولليوم الحالي فقط — فلا تتأثّر التواريخ الرجعية.
        // الموضع يتقدّم في أيام العمل فقط؛ ويومُ الإجازة المُتاح لا يُحرّك الخطّة
        if (isToday && student && !currentRecorded && !keepPosition) {
          // ⬆ إلى **ما سُمِع فعلاً** لا إلى المقدار المخطَّط (الجدولة التكيّفية)
          const dir =
            mode === 'hifz'
              ? (student.hifzDirection ?? 'nas-to-baqarah')
              : (student.murajaahDirection ?? 'nas-to-baqarah');
          const bounds = mode === 'murajaah' ? murajaahBoundsOf(student) : undefined;
          // الموضع يتقدّم بالمقطع **الجديد** وحده: المقطع المتراكم (نافذة الربط أو
          // تأسيس جزء عمّ) لا يُزحزحه، وإلا قفز الطالب إلى نهاية المتراكم كلّه.
          const newTo = dailyPlan?.newTo ?? actualTo;
          const advancedTo = earlierInDirection(actualTo, newTo, dir);
          const actual = positionAfterRecited(advancedTo, dir, bounds);
          const next = actual ?? nextPositionAfter(student, mode);
          // نافذة الربط التراكمي: يُسجَّل مقطع اليوم الجديد (آخر مقطعين فقط)
          if (mode === 'hifz') {
            const portion = { from: dailyPlan?.newFrom ?? actualFrom, to: advancedTo };
            await db.student.update(
              studentId,
              { hifzWindow: nextHifzWindow(student.hifzWindow, portion) } as never,
            );
          }
          if (next) {
            await db.student.update(
              studentId,
              (mode === 'hifz'
                ? { currentSurah: next.surah, currentAyah: next.ayah }
                : { murajaahCurrentSurah: next.surah, murajaahCurrentAyah: next.ayah }) as never,
            );
            setStudent((prev) =>
              prev
                ? mode === 'hifz'
                  ? { ...prev, currentSurah: next.surah, currentAyah: next.ayah }
                  : {
                      ...prev,
                      murajaahCurrentSurah: next.surah,
                      murajaahCurrentAyah: next.ayah,
                    }
                : prev,
            );
          }
        }
        await refreshDaySession();
        setJustSaved({ mode, updated: wasRecorded });
      } catch (e) {
        console.error('فشل حفظ الجلسة', e);
      }
    }
  };

  /** إنهاء الجلسة وحدها (بعد اكتمال جزأيها) — يعود إلى لوحة الحلقة. */
  const finalizeSession = () => {
    resetSession();
    onClose();
  };

  /** ما الذي سيفعله الزر الأساسي الآن؟
   *  • save     — المادة لم تُسجَّل بعد ⇒ تسليمها.
   *  • update   — مسجّلة والأخطاء تغيّرت (أو الجزء الآخر لم ينتهِ) ⇒ تحديث درجتها.
   *  • finalize — الجزآن مسجّلان ولا تعديل معلّق ⇒ «تسليم التسميع» وإغلاق. */
  const primaryMode: 'save' | 'update' | 'finalize' = !currentRecorded
    ? 'save'
    : bothSettled && !gradeDirty
      ? 'finalize'
      : 'update';
  const primaryLabel =
    primaryMode === 'finalize'
      ? 'تسليم التسميع'
      : primaryMode === 'update'
        ? 'تحديث الدرجة'
        : `تسليم ${MODE_LABEL[mode]}`;

  const primaryAction = () => {
    if (primaryMode === 'finalize') finalizeSession();
    else void approvePart();
  };

  // إنهاء المادة الحالية بـ«لم يحفظ» (استقلالٌ تامّ — لا يمسّ المادة الأخرى).
  const abortAsNotMemorized = async () => {
    if (studentId !== undefined) {
      try {
        await markNotMemorized(studentId, day, mode, `${assignmentLabel} (لم يحفظ)`);
        await refreshDaySession();
        setJustSaved({ mode, updated: false });
      } catch (e) {
        console.error('فشل تسجيل «لم يحفظ»', e);
      }
    }
  };

  // سقف آيات السورة المختارة (من فهرس المنهج) — يضبط عدّاد «إلى آية».
  const surahMeta = allSurahs().find((s) => s.key === surah || s.name === surah);
  const maxAyahOfSurah = surahMeta?.ayahs ?? 999;

  const changeStart = (delta: number) => {
    setTouched(true);
    setStartVerse((v) => Math.max(1, Math.min(maxAyahOfSurah - 1, v + delta)));
  };
  const changeEnd = (delta: number) => {
    setTouched(true);
    setEndVerse((v) => Math.max(startVerse + 1, Math.min(maxAyahOfSurah, v + delta)));
  };

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-[#120D0A]/95 backdrop-blur-2xl"
    >
      {/* ---- Sticky header inside the overlay ---- */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-white/10 bg-[#18120E]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          {/* Right: student name + grade */}
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold text-[#F5EBE1]">
              تسميع الطالب: {studentName}
            </h2>
            <p className="truncate text-xs text-amber-100/50">
              {level || (mode === 'hifz' ? 'حفظ الآيات' : 'مراجعة الأوجه')} ·{' '}
              {PERIOD_LABEL[ringPeriod]}
            </p>
          </div>

          {/* Left: plan + close */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => {
                if (studentId != null && student) navigate(planHash(student.ringId, studentId));
              }}
              aria-label="خطة الطالب"
              className="press flex items-center gap-1 rounded-full bg-amber-100/10 px-2.5 py-2 text-xs font-bold text-amber-200 ring-1 ring-inset ring-amber-500/25 hover:bg-amber-100/20"
            >
              📋 الخطة
            </button>
            <button
              onClick={onClose}
              aria-label="إغلاق التسميع"
              className="press flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-2 text-xs font-extrabold text-rose-300 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/25"
            >
              <X className="h-4 w-4" />
              إغلاق
            </button>
          </div>
        </div>
      </header>

      {/* ---- Scrollable content ---- */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg space-y-4 p-4">
          {/* Segmented Control: حفظ / مراجعة — وعلامة ✓ على ما سُجِّل منهما */}
          <div className="flex rounded-full bg-amber-100/10 p-1">
            {(['hifz', 'murajaah'] as Mode[]).map((m) => {
              const active = mode === m;
              const mark = m === 'hifz' ? marks.hifz : marks.murajaah;
              // مرحلة تأسيس جزء عمّ: مسار المراجعة موقوف ⇒ الزرّ معطَّل ووسمه صريح
              const suspendedTab = m === 'murajaah' && !!student && onboardingActive(student);
              return (
                <button
                  key={m}
                  onClick={() => (suspendedTab ? undefined : setMode(m))}
                  onClickCapture={undefined}
                  aria-pressed={active}
                  disabled={suspendedTab}
                  aria-disabled={suspendedTab}
                  title={suspendedTab ? 'المراجعة موقوفة في مرحلة تأسيس جزء عمّ' : undefined}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-sm font-extrabold transition-all ${
                    active
                      ? 'bg-[#B8860B] text-white shadow-md shadow-amber-700/40'
                      : 'text-amber-100/60 hover:text-amber-100'
                  } ${suspendedTab ? 'cursor-not-allowed opacity-35' : ''}`}
                >
                  {m === 'hifz' ? 'حفظ' : suspendedTab ? 'مراجعة (موقوفة)' : 'مراجعة'}
                  {mark === 'done' && <span aria-hidden>✓</span>}
                  {mark === 'not_recited' && <span aria-hidden>⛔</span>}
                </button>
              );
            })}
          </div>

          {/* حالة جزأي اليوم — واضحة داخل الورقة كما على البطاقة */}
          <div className="grid grid-cols-2 gap-1.5">
            <PartStatus subject="حفظ" mark={marks.hifz} score={marks.hifzScore} />
            <PartStatus subject="مراجعة" mark={marks.murajaah} score={marks.murajaahScore} />
          </div>

          {/* ── مهمّة اليوم المحسوبة من محرّك التدرّج (مصدر الحقيقة) ── */}
          {dailyPlan ? (
            <div className="rounded-2xl border border-amber-400/40 bg-[#B8860B]/15 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <ListChecks className="h-4 w-4 shrink-0 text-amber-300" />
                <p className="text-xs font-bold text-amber-100/75">مهمّة اليوم محسوبة من المنهج</p>
                {dailyPlan.paused && (
                  <span className="rounded-full bg-stone-500/30 px-2 py-0.5 text-[10px] font-extrabold text-amber-100/70">
                    ⏸ الحفظ موقوف — مراجعة فقط
                  </span>
                )}
              </div>
              <p className="mt-1 text-lg font-extrabold leading-snug text-amber-200">
                {dailyPlan.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/55">
                {dailyPlan.ayahs} آية ≈ {dailyPlan.pages} وجه · المقدار {dailyPlan.amount}{' '}
                {dailyPlan.unit} · {DIRECTION_LABEL[dailyPlan.direction]}
              </p>
              {touched && (
                <p className="mt-1 text-[11px] font-bold text-amber-300/70">
                  عدّلت النطاق يدوياً — سيُسجَّل تعديلك.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100/60">
              لا توجد مهمّة محسوبة بعد — اضبط نقطة البداية والمقدار من «تعديل بيانات الطالب»
              (زر تعديل في بطاقته).
            </p>
          )}

          {/* Live target indicator */}
          <div className="flex items-center justify-between rounded-xl bg-amber-100/5 px-4 py-2 ring-1 ring-inset ring-amber-500/15">
            <span className="text-xs font-bold text-amber-100/60">
              {mode === 'hifz' ? 'الهدف اليومي (حفظ)' : 'الهدف اليومي (مراجعة)'}
            </span>
            <span className="text-sm font-extrabold text-amber-300">{target}</span>
          </div>

          {/* Assignment box */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-100/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-[#F5EBE1]">
                {/* المهمّة المحسوبة بدقّة (قد تمتد لسورة تالية) */}
                {dailyPlan && !touched ? dailyPlan.label : assignmentLabel}
              </p>
              <button
                onClick={openMushaf}
                className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-[#B8860B] px-3 py-2 text-sm font-extrabold text-white shadow-md shadow-amber-700/40 hover:brightness-110"
              >
                📖 مصحف مرئي
              </button>
            </div>

            {/* ===== Re-laid-out verse selection: clean 2-row grid ===== */}
            {/* Row 1: Surah selector (full width) */}
            <div className="mt-3 grid grid-cols-1 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-amber-100/50">السورة</span>
                <select
                  value={surah}
                  onChange={(e) => {
                    setSurah(e.target.value);
                    setTouched(true);
                  }}
                  className="w-full appearance-none rounded-xl border border-amber-500/25 bg-[#1e140d] px-4 py-2.5 text-sm font-bold text-[#F5EBE1] outline-none focus:border-amber-400/60 focus:ring-2 focus:ring-amber-500/30"
                >
                  {allSurahs().length > 0 ? (
                    allSurahs().map((s) => (
                      <option key={s.n} value={s.key}>
                        {s.n}. {s.key}
                      </option>
                    ))
                  ) : (
                    <option value={surah}>{surah}</option>
                  )}
                </select>
              </label>
            </div>

            {/* Row 2: من آية (start) | إلى آية (end) — two clean columns */}
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-amber-100/10 px-3 py-2">
                <p className="mb-1 text-center text-[11px] font-bold text-amber-100/50">من آية</p>
                <div className="flex items-center justify-between gap-1">
                  <button
                    onClick={() => changeStart(-1)}
                    aria-label="إنقاص آية البداية"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100/15 text-lg font-bold text-amber-100 hover:bg-amber-100/25 active:scale-95"
                  >
                    −
                  </button>
                  <span className="text-center text-xl font-extrabold text-[#F5EBE1]">
                    {startVerse}
                  </span>
                  <button
                    onClick={() => changeStart(+1)}
                    aria-label="زيادة آية البداية"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100/15 text-lg font-bold text-amber-100 hover:bg-amber-100/25 active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-amber-100/10 px-3 py-2">
                <p className="mb-1 text-center text-[11px] font-bold text-amber-100/50">إلى آية</p>
                <div className="flex items-center justify-between gap-1">
                  <button
                    onClick={() => changeEnd(-1)}
                    aria-label="إنقاص آية النهاية"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100/15 text-lg font-bold text-amber-100 hover:bg-amber-100/25 active:scale-95"
                  >
                    −
                  </button>
                  <span className="text-center text-xl font-extrabold text-[#F5EBE1]">
                    {endVerse}
                  </span>
                  <button
                    onClick={() => changeEnd(+1)}
                    aria-label="زيادة آية النهاية"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100/15 text-lg font-bold text-amber-100 hover:bg-amber-100/25 active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* تنبيه لطيف عند امتداد المهمّة إلى سورة تالية */}
            {dailyPlan && !touched && dailyPlan.to.surah !== dailyPlan.from.surah && (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-200/80">
                المهمّة تمتد إلى سورة {surahShort(dailyPlan.to.surah)} — تُحسب تلقائياً من المنهج.
              </p>
            )}

            {/* Dynamic preview — cleanly separated */}
            <p className="mt-4 border-t border-amber-500/10 pt-3 text-right text-sm font-medium leading-relaxed text-amber-100/40">
              {endVerseSnippet[surah] ?? 'حتى قوله تعالى: ﴿ … ﴾'}
            </p>
          </div>

          {/* Score & mistakes counter — عدّادٌ خاصّ بالمادة المعروضة وحدها */}
          <div className="flex items-center justify-between rounded-2xl bg-amber-100/5 px-4 py-3 ring-1 ring-inset ring-amber-500/15">
            <div>
              <p className="text-xs font-bold text-amber-100/60">
                الأخطاء يدويًا — {MODE_LABEL[mode]}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <button
                  onClick={() => setMistakes((m) => Math.max(0, m - 1))}
                  aria-label={`إنقاص أخطاء ${MODE_SHORT[mode]}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100/10 text-lg font-bold text-amber-100 hover:bg-amber-100/20 active:scale-95"
                >
                  −
                </button>
                <span
                  data-errors={mode}
                  className="w-8 text-center text-xl font-extrabold text-[#F5EBE1]"
                >
                  {mistakes}
                </span>
                <button
                  onClick={() => setMistakes((m) => Math.min(20, m + 1))}
                  aria-label={`زيادة أخطاء ${MODE_SHORT[mode]}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100/10 text-lg font-bold text-amber-100 hover:bg-amber-100/20 active:scale-95"
                >
                  +
                </button>
              </div>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold text-amber-100/60">الدرجة</p>
              <p className="text-2xl font-extrabold text-amber-300">{scoreText(score)}</p>
            </div>
          </div>
        </div>
      </main>

      {/* ---- Floating bottom action bar (always visible) ---- */}
      <footer className="sticky bottom-0 z-20 shrink-0 border-t border-amber-500/20 bg-[#18120E]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto max-w-lg space-y-2">
          {/* «لم يحفظ» للمادة المعروضة فقط — مستقلةٌ تماماً عن المادة الأخرى */}
          <button
            onClick={abortAsNotMemorized}
            aria-label={`لم يحفظ (${MODE_SHORT[mode]})`}
            aria-pressed={currentIsFailed}
            title={
              currentIsFailed
                ? `اضغط للتراجع عن «لم يحفظ» في ${MODE_LABEL[mode]}`
                : `تسجيل «لم يحفظ» في ${MODE_LABEL[mode]} فقط`
            }
            className={`press flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-extrabold ring-1 ring-inset transition ${
              currentIsFailed
                ? 'bg-rose-600 text-white ring-rose-500/50 shadow-md shadow-rose-800/30'
                : 'bg-rose-500/10 text-rose-300 ring-rose-500/30 hover:bg-rose-500/20'
            }`}
          >
            <XCircle className="h-4 w-4" />
            {currentIsFailed
              ? `مسجّل: لم يحفظ (${MODE_SHORT[mode]}) ✓`
              : `لم يحفظ (${MODE_SHORT[mode]})`}
          </button>

          {/* توجيه لطيف بعد تسجيل/تحديث مادة */}
          {justSaved?.mode === mode && currentRecorded && (
            <p className="text-center text-[11px] font-bold text-emerald-300/85">
              {primaryMode === 'finalize'
                ? 'اكتمل جزءا الجلسة — اضغط «تسليم التسميع»'
                : justSaved.updated
                  ? `تمّ تحديث درجة ${MODE_LABEL[mode]} ✓ (${scoreText(score)})`
                  : `تمّ تسجيل ${MODE_LABEL[mode]} ✓ — انتقل إلى ${MODE_LABEL[otherMode]} ⏩`}
            </p>
          )}

          <div className="flex gap-3">
            {/* زر الانتقال: يُعطَّل إذا كانت المادة الأخرى مسجّلةً بالفعل */}
            <button
              onClick={() => setMode(otherMode)}
              disabled={otherRecorded}
              aria-disabled={otherRecorded}
              title={
                otherRecorded ? `${MODE_LABEL[otherMode]} مسجّلة في هذا اليوم بالفعل` : undefined
              }
              className={`press flex-1 rounded-2xl py-3 text-sm font-bold transition ${
                otherRecorded
                  ? 'cursor-not-allowed bg-amber-100/[0.04] text-amber-100/30 ring-1 ring-inset ring-amber-500/10'
                  : 'bg-amber-100/10 text-amber-200 hover:bg-amber-100/20'
              }`}
            >
              {otherRecorded ? `✓ تمّ ${MODE_SHORT[otherMode]}` : `التالي: ${MODE_SHORT[otherMode]} ⏩`}
            </button>

            {/* الزر الأساسي: تسليم الجزء · تحديث درجةٍ مسجّلة · تسليم التسميع */}
            <button
              onClick={primaryAction}
              className={`press flex flex-[1.4] items-center justify-center gap-2 rounded-2xl py-3 text-base font-extrabold text-white shadow-lg transition hover:brightness-110 ${
                primaryMode === 'finalize'
                  ? 'bg-emerald-600 shadow-emerald-900/40'
                  : primaryMode === 'update'
                    ? 'bg-sky-700 shadow-sky-900/40'
                    : 'bg-[#B8860B] shadow-amber-700/40'
              }`}
            >
              <Check className="h-5 w-5" />
              {primaryLabel}
            </button>
          </div>
        </div>
      </footer>

      {/* Nested overlay: the weekly plan (renders above via higher z-index) */}
    </div>,
    document.body,
  );
}
