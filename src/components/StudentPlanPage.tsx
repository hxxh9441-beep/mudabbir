// src/components/StudentPlanPage.tsx
// **صفحة «خطة الطالب» الكاملة** (مسار مستقلّ #/circle/:id/student/:sid/plan)
// بدل النافذة السفلية المضغوطة: ترويسةٌ فيها زرّ رجوع، ورحابةٌ للجدول الأسبوعي
// وحبّات المقدار وزرّي PDF/Excel.
//
// الجدول يبنيه محرّك الإسقاط (planProjection) بمقاطع سورة/آية حقيقية:
//   • حفظ الربط التراكمي: كل مقطع يبقى في المهمّة ثلاثة أيام عملٍ متتالية.
//   • تأسيس جزء عمّ: من الناس صفحتان تُضافان تراكمياً حتى سورة الفجر.
//   • أيام الإجازة تُسقط، والأيام المسجَّلة تُعرض بمقطعها الفعلي (مرساة ثابتة).
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight } from 'lucide-react';
import { db } from '../db';
import type { RingPeriod } from '../db/schema';
import { projectWeek, isoD, type PlanDay } from '../utils/planProjection';
import { addDays, weekStartOf } from '../utils/ringDays';
import { ONBOARDING_PAGES, onboardingActive } from '../utils/dailyPlan';
import AppBackground from './AppBackground';
import {
  buildMonthCsv,
  buildMonthExport,
  buildReportXlsx,
  downloadBytes,
  downloadText,
  EXPORT_HEADERS,
  exportFileBase,
  monthLabel,
  recentMonths,
} from '../utils/planExport';

interface Props {
  ringId: number;
  studentId: number;
  onBack: () => void;
}

const PERIOD_LABEL: Record<RingPeriod, string> = {
  Fajr: 'الفجر',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء',
};
const AR_DIGITS = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];


/** سطر مقطعٍ واحد داخل اليوم: «📖 حفظ: النبا 1 - 9». */
function SliceLine({ kind, day }: { kind: 'hifz' | 'murajaah'; day: PlanDay }) {
  const slice = kind === 'hifz' ? day.hifz : day.murajaah;
  if (!slice) return null;
  const isHifz = kind === 'hifz';
  const cumulative = isHifz && slice.kind !== 'simple' && slice.newRange !== slice.range;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold">
        <span className={isHifz ? 'text-amber-700 dark:text-amber-300' : 'text-orange-700 dark:text-orange-300'}>
          {isHifz ? '📖 حفظ:' : '🔄 مراجعة:'}
        </span>
        <span className="truncate text-[#2D1F17] dark:text-[#F5EBE1]">{slice.range}</span>
        {day.recorded && slice.amount > 0 ? (
          <span className="shrink-0 text-[11px] font-semibold text-[#8a7261] dark:text-amber-100/45">
            {AR_DIGITS(slice.amount)} {slice.unit}
          </span>
        ) : null}
      </span>
      {cumulative && !day.recorded ? (
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#8a7261] dark:text-amber-100/45">
          <span>جديد اليوم:</span>
          <span className="text-[#2D1F17] dark:text-[#F5EBE1]">{slice.newRange}</span>
          {slice.kind === 'onboarding' ? <span>(تأسيس جزء عمّ)</span> : <span>(ربط ٣ أيام)</span>}
        </span>
      ) : null}
    </span>
  );
}

/** ترويسة صفحة الخطّة — واحدةٌ لكل الحالات (تحميل · طالب غير موجود · العرض)
 *  فلا يمكن أن تنحرف ترويسةٌ عن أختها. شفّافةٌ بضبابٍ خفيف ليمرّ التدرّج. */
function PlanHeader({ onBack, label, sub }: { onBack: () => void; label: string; sub?: string }) {
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-black/[0.06] bg-white/20 px-4 py-3 backdrop-blur-md print:hidden dark:border-white/10 dark:bg-black/20">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <button
          onClick={onBack}
          aria-label="رجوع"
          className="press flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-3 py-2 text-sm font-bold text-[#5A4636] hover:bg-black/10 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
        >
          <ArrowRight className="h-4 w-4" />
          رجوع
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-lg font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">{label}</h1>
          {sub ? (
            <p className="truncate text-xs font-semibold text-[#5F5044] dark:text-amber-100/70">{sub}</p>
          ) : null}
        </div>
        <div className="w-[72px] shrink-0" aria-hidden />
      </div>
    </header>
  );
}

export default function StudentPlanPage({ studentId, onBack }: Props) {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(isoD()));

  const data = useLiveQuery(async () => {
    const student = await db.student.get(studentId);
    if (!student) return null;
    const ring = await db.ring.get(student.ringId);
    const sessions = await db.session.where('studentId').equals(studentId).toArray();
    return { student, ring: ring ?? null, sessions };
  }, [studentId]);

  const today = isoD();
  const week = useMemo(() => {
    if (!data?.ring) return null;
    return projectWeek({
      student: data.student,
      ring: data.ring,
      sessions: data.sessions,
      weekStart,
      today,
    });
  }, [data, weekStart, today]);

  // `undefined` = لم تنتهِ القراءة بعد (تحميل) — و`null` = الطالب غير موجود
  // فعلاً (حُذف مثلاً). كانت الحالتان تُعرضان «جارٍ التحميل…» إلى الأبد، فتبقى
  // الشاشة فارغة. الآن لكلٍّ منها شاشتها الصحيحة، والترويسة تظهر دائماً.
  /**
   * ⚠️ قاعدة الـHooks: هذه الخطّافات **قبل** أيّ إرجاعٍ مبكّر. كانت موضوعةً
   * بعد فروع (التحميل/غير موجود) فأدّى ذلك إلى اختلاف عدد الخطّافات بين
   * رسمةٍ وأخرى ⇒ «Rendered more hooks than during the previous render» ⇒
   * انهيار الصفحة (والتقطه حاجز الخطأ).
   */
  const [exportMonth, setExportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  /** مستند الشهر — مصدرٌ واحد للطباعة وللـCSV فلا يختلفان */
  const exportDoc = useMemo(() => {
    const st = data?.student;
    const rg = data?.ring;
    if (!st || !rg) return null;
    try {
      return buildMonthExport({
        student: st,
        ring: rg,
        sessions: data.sessions,
        month: exportMonth,
        today,
      });
    } catch (e) {
      console.error('[مُدِّر] تعذّر بناء مصدَّر الشهر:', e);
      return null;
    }
  }, [data, exportMonth, today]);

  if (data === undefined) {
    return (
      <div className="app-bg fixed inset-0 z-40 flex flex-col">
        <AppBackground />
        <PlanHeader onBack={onBack} label="خطة الطالب" sub="جارٍ التحميل…" />
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <p className="text-sm font-semibold text-[#7a6450] dark:text-amber-100/60">جارٍ التحميل…</p>
        </div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="app-bg fixed inset-0 z-40 flex flex-col">
        <AppBackground />
        <PlanHeader onBack={onBack} label="خطة الطالب" sub="الطالب غير موجود" />
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/[0.04] text-3xl dark:bg-white/5">
            👤
          </span>
          <p className="text-base font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
            هذا الطالب لم يعد موجوداً
          </p>
          <p className="max-w-xs text-sm font-semibold text-[#7a6450] dark:text-amber-100/60">
            ربّما حُذف من الحلقة — ارجع إلى اللوحة واختر طالباً آخر.
          </p>
          <button
            onClick={onBack}
            className="press mt-1 rounded-2xl bg-[#B8860B] px-5 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-amber-700/30 hover:brightness-110"
          >
            رجوع إلى الحلقة
          </button>
        </div>
      </div>
    );
  }

  const student = data.student;
  const ring = data.ring;
  const studentLabel = student.name;
  const periodLabel = ring ? PERIOD_LABEL[ring.period] : '';
  const days = week?.days ?? [];
  const shown = days.filter((d) => d.work || d.recorded);

  /**
   * **مرحلة التأسيس تُقاس بالأسبوع المعروض** لا بحالة الطالب وحدها:
   *   • onbDays  = عدد أيام التأسيس في الأسبوع المعروض
   *   • onbPure  = كل أيام الأسبوع تأسيس ⇒ تُعرض حبّة التأسيس (٢ أوجه)
   *   • revPaused= كل أيام الأسبوع مراجعتُها موقوفة ⇒ تُعرض «متوقفة مؤقتاً»
   * فمتى تجاوز الطالب الفجر عادت الحبّات إلى قيم ملفّه، واختفى التنبيه
   * (أو صار سطراً يقول إنّ المرحلة انتهت).
   */
  const workShown = shown.filter((d) => d.work);
  const onbDays = workShown.filter((d) => d.hifz?.kind === 'onboarding').length;
  const onbPure = workShown.length > 0 && onbDays === workShown.length;
  const revPausedAll = workShown.length > 0 && workShown.every((d) => d.murajaahSuspended);
  // «كان تأسيساً»: طالبٌ بدأ من الناس ١ حصراً — فيُذكر انتهاء المرحلة صراحةً
  const nasStarter =
    (student.hifzStartSurah ?? 114) === 114 && (student.hifzStartAyah ?? 1) === 1;
  const wasOnboarding = onboardingActive(student) || onbDays > 0 || nasStarter;

  /**
   * **PDF عبر الطباعة** — لا jsPDF. المتصفّح يعرف تشكيل العربيّة وخطّنا
   * فيُخرج جدولاً A4 سليماً، ويحفظه المعلّم PDF من نافذة الطباعة (أو يشاركه).
   * نُبدّل عنوان المستند مؤقّتاً ليصير اسم الملفّ المحفوظ واضحاً.
   */
  const exportPDF = () => {
    if (!exportDoc) return;
    const prev = document.title;
    document.title = exportFileBase(studentLabel, exportMonth);
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.setTimeout(() => window.print(), 60);
    window.setTimeout(restore, 15000); // شبكة أمان
  };

  /** **Excel (xlsx)** منسَّق: أعمدةٌ واضحة ومُهيَّأة للطباعة والكتابة اليدويّة */
  const exportExcel = () => {
    if (!exportDoc) return;
    try {
      const bytes = buildReportXlsx(exportDoc);
      downloadBytes(
        bytes,
        `${exportFileBase(studentLabel, exportMonth)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (e) {
      console.error('[مُدَبِّر] تعذّر بناء xlsx:', e);
      // شبكة أمان: CSV بـBOM يعمل في كل حال
      downloadText(
        buildMonthCsv(exportDoc),
        `${exportFileBase(studentLabel, exportMonth)}.csv`,
        'text/csv;charset=utf-8;',
      );
    }
  };

  return (
    <div className="app-bg fixed inset-0 z-40 flex flex-col print:static print:block">
      <AppBackground />
      {/* الترويسة الموحَّدة */}
      <PlanHeader
        onBack={onBack}
        label="خطة الطالب"
        sub={`${studentLabel}${ring ? ` · ${ring.name} · ${periodLabel}` : ''}`}
      />

      <main className="relative z-10 flex-1 overflow-y-auto pb-28 print:hidden">
        <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
          {/* حبّات المقدار اليومي */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-amber-900/10 bg-amber-500/[0.08] px-3 py-3 text-center dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="text-[13px] font-extrabold text-amber-800 dark:text-amber-200">
                📖 حفظ: {AR_DIGITS(onbPure ? ONBOARDING_PAGES : (week?.hifzQuota ?? 0))}{' '}
                {onbPure ? 'أوجه (تأسيس)' : 'أسطر'} يومياً
              </p>
            </div>
            {revPausedAll ? (
              <div
                data-murajaah-suspended="1"
                className="rounded-2xl border border-dashed border-black/15 bg-black/[0.02] px-3 py-3 text-center dark:border-white/15 dark:bg-white/5"
              >
                <p className="text-[13px] font-extrabold text-[#8a7261] dark:text-amber-100/60">
                  🔄 المراجعة: متوقفة مؤقتاً — مرحلة تأسيس جزء عمّ
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-orange-900/10 bg-orange-500/[0.08] px-3 py-3 text-center dark:border-orange-500/20 dark:bg-orange-500/10">
                <p className="text-[13px] font-extrabold text-orange-800 dark:text-orange-200">
                  🔄 مراجعة: {AR_DIGITS(week?.murajaahQuota ?? 0)} أوجه يومياً
                </p>
              </div>
            )}
          </div>

          {onbDays > 0 ? (
            <p
              data-onboarding="1"
              className="rounded-2xl border border-amber-900/10 bg-black/[0.03] px-3.5 py-2.5 text-center text-[12px] font-bold text-[#6B5B4A] dark:border-white/10 dark:bg-white/5 dark:text-amber-100/70"
            >
              تأسيس جزء عمّ: صفحتان تُضافان تراكمياً من الناس حتى سورة الفجر
            </p>
          ) : wasOnboarding ? (
            <p
              data-onboarding-done="1"
              className="rounded-2xl border border-green-700/20 bg-green-700/[0.07] px-3.5 py-2.5 text-center text-[12px] font-bold text-green-800 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-300"
            >
              ✓ انتهت مرحلة التأسيس (أُتمّت سورة الفجر) — الحفظ من سورة الغاشية، وعادت المراجعة من الفجر إلى الناس
            </p>
          ) : null}

          {/* التنقّل بين الأسابيع */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              aria-label="الأسبوع السابق"
              className="press flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-[#5A4636] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100"
            >
              ‹
            </button>
            <span className="rounded-full bg-[#B8860B]/15 px-4 py-1.5 text-[13px] font-extrabold text-[#8a6508] ring-1 ring-inset ring-[#B8860B]/25 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/25">
              {AR_DIGITS(Number(weekStart.slice(8, 10)))} {MONTHS[Number(weekStart.slice(5, 7)) - 1]} –{' '}
              {AR_DIGITS(Number((week?.weekEnd ?? weekStart).slice(8, 10)))}{' '}
              {MONTHS[Number((week?.weekEnd ?? weekStart).slice(5, 7)) - 1]}
            </span>
            <button
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              aria-label="الأسبوع التالي"
              className="press flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-[#5A4636] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100"
            >
              ›
            </button>
            {weekStart !== weekStartOf(today) ? (
              <button
                onClick={() => setWeekStart(weekStartOf(today))}
                className="press rounded-full bg-black/[0.05] px-3 py-1.5 text-[12px] font-bold text-[#5A4636] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100"
              >
                هذا الأسبوع
              </button>
            ) : null}
          </div>

          {/* أيام الأسبوع */}
          <div className="space-y-2 md:grid md:grid-cols-2 md:gap-2 md:space-y-0">
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm font-bold text-[#6B5B4A] dark:text-amber-100/70 md:col-span-2">
                لا أيام عمل في هذا الأسبوع
              </p>
            ) : null}
            {shown.map((d) => {
              const off = !d.work;
              return (
                <div
                  key={d.date}
                  data-plan-day={d.date}
                  data-work={d.work ? '1' : '0'}
                  data-recorded={d.recorded ? '1' : '0'}
                  className={`rounded-2xl bg-black/[0.02] px-3.5 py-3 dark:bg-white/5 ${
                    d.isToday ? 'ring-2 ring-[#B8860B]/50' : 'ring-1 ring-inset ring-black/5 dark:ring-white/10'
                  } ${off ? 'opacity-70' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">{d.dayName}</span>
                      <span className="text-[12px] font-bold text-[#8a7261] dark:text-amber-100/45">
                        {AR_DIGITS(d.dayOfMonth)}/{AR_DIGITS(d.month)}
                      </span>
                      {d.isToday ? (
                        <span className="rounded-full bg-[#B8860B] px-2 py-[1px] text-[10px] font-extrabold text-white">
                          اليوم
                        </span>
                      ) : null}
                    </span>
                    {off ? (
                      <span className="rounded-full bg-black/[0.05] px-2.5 py-[3px] text-[11px] font-bold text-[#8a7261] dark:bg-white/10 dark:text-amber-100/50">
                        إجازة
                      </span>
                    ) : d.recorded ? (
                      <span className="flex items-center gap-1">
                        {d.adjusted ? (
                          <span
                            title="سُجّل بمقطعٍ مخالفٍ للمخطَّط ⇒ إعادة الجدولة تبدأ من هنا"
                            className="rounded-full bg-amber-500/15 px-2 py-[3px] text-[10px] font-extrabold text-amber-800 dark:text-amber-200"
                          >
                            عُدِّل
                          </span>
                        ) : null}
                        <span className="rounded-full bg-green-700 px-2.5 py-[3px] text-[11px] font-extrabold text-white">
                          {d.score !== undefined ? `${AR_DIGITS(d.score)}/٢٠` : 'سُجّل ✓'}
                        </span>
                      </span>
                    ) : (
                      <span className="rounded-full bg-black/[0.05] px-2.5 py-[3px] text-[11px] font-bold text-[#8a7261] dark:bg-white/10 dark:text-amber-100/50">
                        مجدول
                      </span>
                    )}
                  </div>

                  {!off && (d.hifz || d.murajaah) ? (
                    <div className="mt-2 flex flex-col gap-1.5 border-t border-black/5 pt-2 dark:border-white/10">
                      <SliceLine kind="hifz" day={d} />
                      {/* لا صفَّ مراجعة في مرحلة التأسيس — يومٌ بلا مقطعٍ لا يُرسم */}
                      {!d.murajaahSuspended ? <SliceLine kind="murajaah" day={d} /> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* أزرار التصدير داخل الصفحة (لها رحابة هنا) */}
          <div className="flex gap-3 pt-1">
            {/* منتقي الشهر ثم الزرّان */}
          <div className="mt-1 flex items-center gap-2">
            <label className="shrink-0 text-[12px] font-bold text-[#6B5B4A] dark:text-amber-100/60">
              شهر التصدير
            </label>
            <select
              value={exportMonth}
              onChange={(e) => setExportMonth(e.target.value)}
              aria-label="شهر التصدير"
              className="min-w-0 flex-1 rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-bold text-[#2D1F17] ring-1 ring-inset ring-black/[0.08] dark:bg-white/[0.06] dark:text-[#F5EBE1] dark:ring-white/10"
            >
              {recentMonths(12).map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={exportPDF}
              disabled={!exportDoc}
              className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#B8860B] py-3 text-sm font-extrabold text-white shadow-lg shadow-amber-700/25 hover:brightness-110 disabled:opacity-50"
            >
              📄 تحميل PDF
            </button>
            <button
              onClick={exportExcel}
              disabled={!exportDoc}
              className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-emerald-700/25 hover:brightness-110 disabled:opacity-50"
            >
              📊 Excel
            </button>
          </div>
          </div>
        </div>
      </main>
      {/*
        ═══ مستند الطباعة (PDF) ═══
        يُرسَل إلى `document.body` عبر بوابة ⇒ فلا يرث تخطيط الصفحة ولا طبقاتها،
        وفي `@media print` نخفي **كل** ما في body إلا هذا الجذر ⇒ لا تُطبَع
        بطاقة الطالب ولا اللوحة ولا الأزرار ولا التدرّج — ورقة A4 نظيفة فقط.
      */}
      {createPortal(
        <div id="print-root" dir="rtl" lang="ar">
          <div className="print-doc">
            {/* ماركة التطبيق — مطابقةٌ للشاشة الرئيسيّة */}
            <div className="print-brand">
              <p className="print-brand-name">مُدَبِّر</p>
              <p className="print-brand-sub">مساعد إدارة الحلقة الأمثل</p>
            </div>
            <h1 className="print-title">{exportDoc?.title ?? 'خطة الطالب الشهرية'}</h1>
            <div className="print-meta">
              <p>
                <strong>الطالب:</strong> {exportDoc?.studentName ?? ''}
                <span className="print-sep">·</span>
                <strong>الحلقة:</strong> {exportDoc?.ringName ?? ''}
                <span className="print-sep">·</span>
                <strong>الشهر:</strong> {exportDoc?.monthLabel ?? ''}
              </p>
              <p>
                <strong>المقدار اليوميّ:</strong> {exportDoc?.quotas ?? ''}
              </p>
            </div>
            <table className="print-table" data-print-table="1">
              <thead>
                <tr>
                  {EXPORT_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(exportDoc?.rows ?? []).map((r) => (
                  <tr key={r.dayDate} className={r.isOff ? 'print-off' : ''}>
                    <td className="print-day">{r.dayDate}</td>
                    <td>{r.hifz}</td>
                    <td className="print-blank" />
                    <td>{r.murajaah}</td>
                    <td className="print-blank" />
                    <td className="print-blank" />
                  </tr>
                ))}
              </tbody>
            </table>

          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
