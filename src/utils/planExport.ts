// src/utils/planExport.ts
// **بناء المصدَّر** (PDF طباعةً + CSV/Excel) لخطّة طالبٍ في شهرٍ كامل.
//
// • PDF: لا نُصدّر بـjsPDF خاماً — فمحرّكات PDF لا تُشكّل الحروف العربيّة
//   وتُخرج رموزاً مشوّهة. البديل الصحيح: **نسخةٌ مبنيّة للطباعة** (HTML/A4)
//   تُعرَض عبر window.print() فيُشكّلها المتصفّح بخطّنا العربيّ ويحفظها
//   المعلّم PDF بجودةٍ كاملة. (لا تشويه، ولا تضمين خطوط، ولا RTL مقلوب.)
// • Excel: ملفّ **CSV بترميز UTF-8 مع BOM** (\uFEFF) ونوع text/csv — تفتحه
//   تطبيقات الجداول على الجوال بلا تلف. (ملفّات xlsx اليدويّة هي ما تلف.)
import type { Ring, Session, Student } from '../db/schema';
import { projectMonth, monthBounds } from './planProjection';
import { surahShort } from './progression';

/** اسم السورة بالعربيّة (من فهرس المنهج) */
const surahName = (n: number) => surahShort(n);
import { buildXlsx, type XCell } from './xlsx';
import { ONBOARDING_PAGES } from './dailyPlan';
import { isoDay as isoD } from '../db/index';

const AR_DIGITS = (s: string | number) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);

export const MONTH_NAMES_AR = [
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

/** «سبتمبر ٢٠٢٦» من مفتاح YYYY-MM */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES_AR[m - 1]} ${AR_DIGITS(y)}`;
}

/** آخر ١٢ شهراً (الأحدث أولاً) — لخيارات المصدَّر */
export function recentMonths(count = 12, from: Date = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < count; i += 1) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export interface ExportRow {
  /** «السبت ١٢/٩» */
  dayDate: string;
  /** نصّ عمود الحفظ مع مقدار الربط */
  hifz: string;
  /** نصّ عمود المراجعة */
  murajaah: string;
  /** علامة التسجيل (✓ مسجَّل · مُعدَّل) */
  mark: string;
  isToday: boolean;
  isOff: boolean;

  // ═══ حقول تقرير المعلّم (أعمدة A..K) ═══
  /** التاريخ مختصراً: «١٢/٩» */
  dateShort: string;
  /** اليوم: «السبت» */
  dayName: string;
  /** الحضور: ✔ حاضر · ✖ غائب · (فراغٌ لليوم الآتي) */
  attendance: string;
  hifzSurah: string;
  hifzFrom: string;
  hifzTo: string;
  hifzScoreText: string;
  murajaahSurah: string;
  murajaahFrom: string;
  murajaahTo: string;
  murajaahScoreText: string;
}

/** أعمدة الجدول الستّة كما طلبها المعلّم — والثلاثة الأخيرة فارغةٌ للتقييم
 *  اليدويّ والتوقيع بعد الطباعة (درجة الحفظ · درجة المراجعة · التوقيع). */
export const EXPORT_HEADERS = [
  'اليوم والتاريخ',
  'الحفظ',
  'درجة الحفظ',
  'المراجعة',
  'درجة المراجعة',
  'توقيع المعلم / ملاحظات',
] as const;

export interface ExportDoc {
  title: string;
  studentName: string;
  ringName: string;
  monthLabel: string;
  /** «سبتمبر ٢٠٢٦ — من ١ إلى ٣٠» */
  monthLine: string;
  /** المقدار اليوميّ المستهدف (حفظ + مراجعة) */
  quotas: string;
  rows: ExportRow[];
  /** كم يوماً عملاً في الشهر */
  workDays: number;
}

/** يبني مستند الشهر كاملاً من محرّك الإسقاط نفسه (لا حساب موازٍ). */
export function buildMonthExport(opts: {
  student: Student;
  ring: Ring;
  sessions: Session[];
  month: string;
  today?: string;
}): ExportDoc {
  const today = opts.today ?? isoD();
  const plan = projectMonth({
    student: opts.student,
    ring: opts.ring,
    sessions: opts.sessions,
    month: opts.month,
    today,
  });
  const shown = plan.days.filter((d) => d.work || d.recorded);
  const rows: ExportRow[] = shown.map((d) => {
    const hifz = d.hifz
      ? `${d.hifz.range} · ${AR_DIGITS(d.hifz.amount)} ${d.hifz.unit}${
          d.hifz.kind === 'onboarding' ? ' (تأسيس)' : ''
        }`
      : '—';
    const murajaah = d.murajaahSuspended
      ? 'موقوفة — تأسيس جزء عمّ'
      : d.murajaah
        ? `${d.murajaah.range} · ${AR_DIGITS(d.murajaah.amount)} ${d.murajaah.unit}`
        : '—';
    return {
      dayDate: `${d.dayName} ${AR_DIGITS(d.dayOfMonth)}/${AR_DIGITS(d.month)}`,
      hifz,
      murajaah,
      mark: d.adjusted ? 'مُعدَّل' : d.recorded ? 'مسجَّل ✓' : 'مخطَّط',
      isToday: d.isToday,
      isOff: !d.work,
      dateShort: `${AR_DIGITS(d.dayOfMonth)}/${AR_DIGITS(d.month)}`,
      dayName: d.dayName,
      attendance: d.isPast ? (d.recorded ? 'حاضر' : 'غائب') : d.isToday && d.recorded ? 'حاضر' : '',
      hifzSurah: d.hifz ? surahName(d.hifz.from.surah) : '',
      hifzFrom: d.hifz ? AR_DIGITS(d.hifz.from.ayah) : '',
      hifzTo: d.hifz
        ? `${d.hifz.to.surah === d.hifz.from.surah ? '' : surahName(d.hifz.to.surah) + ' '}${AR_DIGITS(
            d.hifz.to.ayah,
          )}`
        : '',
      hifzScoreText: d.score !== undefined ? AR_DIGITS(d.score) : '',
      murajaahSurah: d.murajaah ? surahName(d.murajaah.from.surah) : '',
      murajaahFrom: d.murajaah ? AR_DIGITS(d.murajaah.from.ayah) : '',
      murajaahTo: d.murajaah
        ? `${
            d.murajaah.to.surah === d.murajaah.from.surah
              ? ''
              : surahName(d.murajaah.to.surah) + ' '
          }${AR_DIGITS(d.murajaah.to.ayah)}`
        : '',
      murajaahScoreText: '',
    };
  });
  const { from, to } = monthBounds(opts.month);
  const onb = rows.some((r) => /تأسيس/.test(r.hifz));
  const revPaused = rows.every((r) => r.murajaah === 'موقوفة — تأسيس جزء عمّ' || r.murajaah === '—');
  return {
    title: 'خطة الطالب الشهرية',
    studentName: opts.student.name,
    ringName: opts.ring.name,
    monthLabel: monthLabel(opts.month),
    monthLine: `${monthLabel(opts.month)} — من ${AR_DIGITS(from.slice(8, 10))} إلى ${AR_DIGITS(
      to.slice(8, 10),
    )}`,
    quotas: `الحفظ: ${AR_DIGITS(onb ? ONBOARDING_PAGES : (opts.student.hifzTarget ?? 0))} ${
      onb ? 'أوجه (تأسيس)' : 'أسطر'
    } يومياً · المراجعة: ${
      revPaused ? 'موقوفة — تأسيس جزء عمّ' : `${AR_DIGITS(opts.student.murajaahTarget ?? 0)} أوجه يومياً`
    }`,
    rows,
    workDays: rows.filter((r) => !r.isOff).length,
  };
}

/** اسم الملفّ الآمن: «خطة-عبد-الرحمان-2026-09» */
export function exportFileBase(studentName: string, month: string): string {
  return `خطة-${studentName.trim().replace(/\s+/g, '-')}-${month}`;
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * **CSV صالح لكل الجداول**: BOM أوّلاً (\uFEFF) لأنّ Excel على الجوال يقرأ
 * الملفّ بالترميز المحلّي بلا BOM فتظهر العربيّة رموزاً مشوّهة. وفواصل أسطر
 * CRLF ليتوافق مع Excel، ونوع text/csv;charset=utf-8.
 */
export function buildMonthCsv(doc: ExportDoc): string {
  const lines: string[][] = [
    [doc.title],
    [`${doc.studentName} — ${doc.ringName}`],
    [`${doc.monthLabel} · ${doc.quotas}`],
    [],
    [...EXPORT_HEADERS],
    ...doc.rows.map((r) => [
      r.dayDate + (r.isToday ? ' (اليوم)' : ''),
      r.hifz,
      r.murajaah,
      '',
      '',
      r.mark === 'مخطَّط' ? '' : r.mark,
    ]),
    [],
    ['التوقيع:', '', '', '', '', ''],
  ];
  const body = lines.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return '\uFEFF' + body + '\r\n';
}

/** يُنزّل نصّاً كملفّ (يُستعمل للـCSV). */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * **ملفّ xlsx منسَّق** (ستة أعمدة كما طلب المعلّم):
 *   A اليوم والتاريخ · B الحفظ والربط · C المراجعة ·
 *   D درجة الحفظ · E درجة المراجعة · F توقيع المعلم
 * مع: رؤوس عريضة بخلفيّةٍ ناعمة (#F3F4F6) ووسطيّة ✓، حدودٌ لكل الخلايا ✓،
 * عرض أعمدةٍ لا يقطع النصّ ✓، ارتفاع صفٍّ مريح للكتابة اليدويّة ✓، وتخطيط
 * الورقة من اليمين إلى اليسار (sheetView rightToLeft) ✓.
 */
export function buildMonthXlsx(doc: ExportDoc): Uint8Array {
  const rows: XCell[][] = [
    [{ v: doc.title, s: 1 }],
    [{ v: `${doc.studentName} — ${doc.ringName}` }],
    [{ v: `${doc.monthLabel} · ${doc.quotas}` }],
    [],
    EXPORT_HEADERS.map((h) => ({ v: h, s: 2 })),
    ...doc.rows.map((r) => [
      { v: r.dayDate + (r.isToday ? ' (اليوم)' : ''), s: 4 },
      { v: r.hifz, s: 3 },
      { v: r.murajaah, s: 3 },
      { v: '', s: 3 },
      { v: '', s: 3 },
      { v: r.mark === 'مخطَّط' ? '' : r.mark, s: 3 },
    ]),
  ];
  return buildXlsx({
    name: 'الخطة الشهرية',
    // عرض الأعمدة: اليوم · الحفظ · المراجعة · درجة الحفظ · درجة المراجعة · التوقيع
    widths: [17, 36, 26, 12, 13, 17],
    rows,
    rowHeightPt: 30, // ≈ ١ سم: يكتب المعلّم الدرجة والتوقيع بخطّ يده بسهولة
  });
}

/** يُنزّل مصفوفة بايتات كملفّ (للـxlsx) */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * **تقرير Excel بنفس تخطيط الـPDF تماماً** — ستّة أعمدة نظيفة:
 *   ماركة (مُدَبِّر / مساعد إدارة الحلقة الأمثل) ثم «خطة الطالب الشهرية»
 *   ثم الطالب · الحلقة · الشهر · المقدار اليوميّ
 *   ثم: اليوم والتاريخ | الحفظ | درجة الحفظ | المراجعة | درجة المراجعة | توقيع المعلم / ملاحظات
 *
 * ملاحظتان مقصودتان:
 *   • الحفظ/المراجعة في **خليّةٍ واحدة مقروءة** («الناس 1 - الكافرون 6») لا
 *     مُفتَّتَين إلى سورة/من/إلى.
 *   • **لا عمود حضور** في ورقة الخطّة (كان يُظهر «غائب» لأيّامٍ لم تأتِ بعد).
 * والاتجاه من اليمين إلى اليسار، وكل الخلايا بحدودٍ ووسطيّة.
 */
export function buildReportXlsx(doc: ExportDoc): Uint8Array {
  const blank: XCell = { v: '' };
  const six = (v: string, s: number): XCell[] => [{ v, s }, ...Array(5).fill(blank)];
  const rows: XCell[][] = [
    // صفوف الترويسة الخمسة — كلٌّ منها **مدمجٌ على A:F** ومُوسَّط
    six('مُدَبِّر', 1), // ١ — الماركة (كبير، عريض، وسطاً)
    six('مساعد إدارة الحلقة الأمثل', 6), // ٢ — السطر الوصفيّ
    six(doc.title, 1), // ٣ — عنوان المستند (عريض، وسطاً)
    six(`الطالب: ${doc.studentName} · الحلقة: ${doc.ringName}`, 9), // ٤ — التفاصيل
    six(`الشهر: ${doc.monthLabel} · ${doc.quotas}`, 9), // ٥ — الشهر والمقدار
    [], // ٦ — فاصل
    EXPORT_HEADERS.map((h) => ({ v: h, s: 2 })), // ٧ — رؤوس الأعمدة الستّة
    ...doc.rows.map((r) => [
      { v: r.dayDate + (r.isToday ? ' (اليوم)' : ''), s: 4 },
      { v: r.hifz, s: 3 },
      { v: '', s: 3 },
      { v: r.murajaah, s: 3 },
      { v: '', s: 3 },
      { v: '', s: 3 },
    ]),
  ];

  return buildXlsx({
    name: 'خطة الطالب الشهرية',
    // اليوم والتاريخ · الحفظ · درجة الحفظ · المراجعة · درجة المراجعة · التوقيع
    widths: [22, 40, 14, 26, 15, 22],
    rows,
    heights: { 1: 32, 2: 18, 3: 26, 4: 18, 5: 18, 7: 24 },
    rowHeightPt: 28,
    // كل صفوف الترويسة مدمجةٌ على عرض الجدول (A..F) لتوسيطٍ حقيقيّ
    merges: ['A1:F1', 'A2:F2', 'A3:F3', 'A4:F4', 'A5:F5'],
  });
}
