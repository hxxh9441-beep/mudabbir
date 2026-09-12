// src/components/DailyReportModal.tsx
// نافذة «التقرير اليومي / المراسلة» لكل طالب في لوحة الحلقة.
//   • تبويبان: «رسالة ولي الأمر» (نبرة تربوية دافئة) و«تقرير الإدارة» (رسمي موجز).
//   • النصّ يُبنى آلياً من جلسة اليوم: الاسم والصفّ، الحلقة والتاريخ، الحضور،
//     مقرَّر الحفظ والمراجعة ودرجاتهما — بالحروف العربية وحسب حالته الفعلية.
//   • «📋 نسخ النصّ» ينسخه إلى الحافظة (مع بديلٍ يعمل بلا HTTPS) ويُظهر إشعاراً.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, ClipboardCopy, MessageSquare, Send, X } from 'lucide-react';
import { formatDayLong } from './DateBar';
import type { Student, StudentStatus } from '../db/schema';
import type { DailyPlan, DayStatuses, DayMark } from '../utils/dailyPlan';

/** ٩ ← ٩ : تحويل الأرقام إلى صورتها العربية الهندية */
const arNum = (v: string | number): string =>
  String(v).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

const ATTENDANCE: Record<string, string> = {
  present: 'حاضر 🟢',
  late: 'متأخر 🟠',
  excused: 'مستأذن 🟡',
  absent: 'غائب 🔴',
  not_prepared: 'لم يُحضّر ⚪',
  not_recited: 'لم يُسمّع ⚪',
};

/** تقدير الدرجة من ٢٠ — كما يكتبه المعلّم في التقارير. */
export function scoreGrade(score?: number): string {
  if (score === undefined) return '';
  if (score <= 0) return '';
  if (score >= 18) return 'ممتاز';
  if (score >= 15) return 'جيد جداً';
  if (score >= 12) return 'جيد';
  if (score >= 8) return 'مقبول';
  return 'يحتاج مراجعة';
}

/** سطر الدرجة: «٢٠/٢٠ ممتاز» أو «لم يُسمّع ⏳» أو «لم يحفظ ⛔».
 *  (بلا أقواسٍ داخلية — فالقوالب تُغلّف الدرجة بأقواسها بنفسها) */
function scoreLine(mark: DayMark, score?: number): string {
  if (mark === 'not_recited') return 'لم يحفظ ⛔';
  if (mark === 'none') return 'لم يُسمّع ⏳';
  if (score === undefined) return 'تمّ التسميع ✓';
  if (score <= 0) return 'لم يحفظ ⛔';
  const grade = scoreGrade(score);
  return `${arNum(score)}/${arNum(20)}${grade ? ` ${grade}` : ''}`;
}

/** «حلقة الفجر» ⇒ «الفجر» — لتفادي «حلقة حلقة الفجر» عند التركيب. */
const cleanRing = (name: string): string =>
  (name || '').replace(/^\s*حلقة\s+/, '').trim() || 'الحلقة';

/** غائب أو مستأذن ⇒ لا تُعرض أسطر الدرجات (حشوٌ لا معنى له). */
const isAway = (a: StudentStatus): boolean => a === 'absent' || a === 'excused';

/** المقرَّر (النطاق) وحده — بلا المقدار، للنبرة الموجزة. */
function rangeOnly(plan: DailyPlan | null, paused = false): string {
  if (paused) return 'الحفظ متوقف مؤقتاً';
  return plan ? arNum(plan.range) : '—';
}

/** المقدار اليومي وحده: «١٠ أسطر» / «٤ أوجه». */
function amountOnly(plan: DailyPlan | null, paused = false): string {
  if (paused) return 'مراجعة فقط';
  return plan ? `${arNum(plan.amount)} ${plan.unit}` : '—';
}

export interface ReportData {
  student: Student;
  ringName: string;
  date: string;
  attendance: StudentStatus;
  marks: DayStatuses;
  hifzPlan: DailyPlan | null;
  murajaahPlan: DailyPlan | null;
}

/** رسالة ولي الأمر — موجزة ودافئة كما تُكتب في واتساب اليوم. */
export function buildParentMessage(d: ReportData): string {
  const { student, marks } = d;
  const away = isAway(d.attendance);
  const lines = [
    'السلام عليكم ورحمة الله وبركاته 🌿',
    `تقرير إنجاز الطالب: ${student.name}`,
    `حلقة: ${cleanRing(d.ringName)} | ${arNum(formatDayLong(d.date))}`,
    '',
    `• الحضور: ${ATTENDANCE[d.attendance] ?? '—'}`,
  ];

  // غائب/مستأذن: سطر الحضور يكفي — بلا أسطر درجاتٍ لا معنى لها.
  if (!away) {
    lines.push(
      `• الحفظ: ${rangeOnly(d.hifzPlan, !!student.hifzPaused)} (${scoreLine(marks.hifz, marks.hifzScore)})`,
      `• المراجعة: ${rangeOnly(d.murajaahPlan)} (${scoreLine(marks.murajaah, marks.murajaahScore)})`,
    );
  }

  lines.push(
    '',
    away
      ? 'شكراً لإبلاغنا — نراه على خير في اللقاء القادم 🌿'
      : 'بارك الله في جهده ونفع به ✨',
    'معلم الحلقة',
  );

  return lines.join('\n');
}

/** تقرير الإدارة — منقّط رسميّ موجز. */
export function buildManagementReport(d: ReportData): string {
  const { student, marks } = d;
  const level = student.level || [student.grade, student.stage].filter(Boolean).join(' ');
  const hifz = scoreLine(marks.hifz, marks.hifzScore);
  const mur = scoreLine(marks.murajaah, marks.murajaahScore);
  const note = student.hifzPaused
    ? 'الطالب في مرحلة مراجعة فقط (حفظ متوقف مؤقتاً).'
    : '—';

  return [
    `📋 تقرير طالب | حلقة ${cleanRing(d.ringName)}`,
    `التاريخ: ${arNum(formatDayLong(d.date))}`,
    `الطالب: ${student.name}${level ? ` (${level})` : ''}`,
    `الحالة: ${ATTENDANCE[d.attendance] ?? '—'}`,
    '',
    `▫️ الحفظ: ${rangeOnly(d.hifzPlan, !!student.hifzPaused)} (${amountOnly(d.hifzPlan, !!student.hifzPaused)})`,
    `   التقييم: ${hifz}`,
    '',
    `▫️ المراجعة: ${rangeOnly(d.murajaahPlan)} (${amountOnly(d.murajaahPlan)})`,
    `   التقييم: ${mur}`,
    '',
    `ملاحظات: ${note}`,
  ].join('\n');
}

/** نسخ نصّ إلى الحافظة — مع بديلٍ يعمل على http العادي (تطبيق الحلقة على الشبكة المحلية). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* نُكمل بالبديل */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type Tab = 'parent' | 'management';

export default function DailyReportModal({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ReportData;
}) {
  const [tab, setTab] = useState<Tab>('parent');
  const [toast, setToast] = useState<string | null>(null);

  const text = useMemo(
    () => (tab === 'parent' ? buildParentMessage(data) : buildManagementReport(data)),
    [tab, data],
  );

  // إشعارٌ يختفي وحده بعد ثانيتين
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!isOpen) return null;

  const onCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setToast('تم نسخ التقرير بنجاح ✓');
      return;
    }
    // بديلٌ أخير: نُحدّد النصّ كاملاً ليكفيه ضغطةُ نسخٍ واحدة (أو ضغطة مطوّلة على الجوال)
    try {
      const el = document.querySelector('[data-report-text]');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } catch {
      /* لا شيء */
    }
    setToast('تعذّر النسخ تلقائياً — النصّ محدَّد، انسخه يدوياً');
  };

  const onWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  };

  const tabCls = (on: boolean) =>
    `press flex-1 rounded-xl px-3 py-2.5 text-sm font-extrabold ring-1 ring-inset transition ${
      on
        ? 'bg-[#B8860B] text-white ring-amber-400/50 shadow-md shadow-amber-800/30'
        : 'bg-black/[0.05] text-[#5A4636] ring-black/10 hover:bg-black/10 dark:bg-amber-100/10 dark:text-amber-100/70 dark:ring-amber-500/20 dark:hover:bg-amber-100/20'
    }`;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="التقرير اليومي وإرسال الرسالة"
        className="animate-slide-up relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border-t border-amber-900/10 bg-amber-50/95 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:border dark:border-white/10 dark:bg-[#241A14]/95"
      >
        {/* الترويسة */}
        <div className="shrink-0 border-b border-amber-900/10 px-5 pb-3 pt-4 dark:border-amber-500/15">
          <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-black/15 dark:bg-amber-200/40 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
              <MessageSquare className="h-5 w-5 shrink-0 text-[#B8860B]" />
              التقرير اليومي — {data.student.name}
            </h2>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#6B5B4A] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100/70 dark:hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* التبويبان */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              aria-pressed={tab === 'parent'}
              data-tab="parent"
              onClick={() => setTab('parent')}
              className={tabCls(tab === 'parent')}
            >
              📨 رسالة ولي الأمر
            </button>
            <button
              type="button"
              aria-pressed={tab === 'management'}
              data-tab="management"
              onClick={() => setTab('management')}
              className={tabCls(tab === 'management')}
            >
              📋 تقرير الإدارة
            </button>
          </div>
        </div>

        {/* معاينة النصّ (قابلة للتحديد والنسخ يدوياً أيضاً) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <pre
            data-report-text
            dir="rtl"
            className="whitespace-pre-wrap break-words rounded-2xl bg-black/[0.04] p-4 text-[13.5px] leading-relaxed text-[#2D1F17] ring-1 ring-inset ring-black/10 dark:bg-black/25 dark:text-[#F5EBE1] dark:ring-amber-500/15"
          >
            {text}
          </pre>
          <p className="mt-2 text-center text-[11px] text-[#6B5B4A] dark:text-amber-100/40">
            يُبنى النصّ آلياً من جلسة هذا اليوم — عدّل الدرجات من «تعديل» ثم أعِد الفتح لتحديثه.
          </p>
        </div>

        {/* الإشعار */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-4">
            <span
              data-toast
              className="animate-fade-in rounded-full bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white shadow-lg shadow-emerald-900/40"
            >
              {toast}
            </span>
          </div>
        )}

        {/* الأزرار */}
        <div className="shrink-0 border-t border-amber-900/10 px-5 py-3 dark:border-amber-500/15">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="press flex flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-[#B8860B] py-3 text-sm font-extrabold text-white shadow-lg shadow-amber-700/40 transition hover:brightness-110"
            >
              <ClipboardCopy className="h-4 w-4" />
              نسخ النص
            </button>
            <button
              type="button"
              onClick={onWhatsApp}
              title="فتح واتساب بالرسالة جاهزة"
              className="press flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-3 text-sm font-extrabold text-white shadow-lg shadow-emerald-900/40 transition hover:brightness-110"
            >
              <Send className="h-4 w-4" />
              واتساب
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-bold text-[#6B5B4A] dark:text-amber-100/45">
            <CheckCheck className="h-3.5 w-3.5" />
            انسخ والصق في واتساب أو الرسائل مباشرةً
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
