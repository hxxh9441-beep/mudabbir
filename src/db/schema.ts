// src/db/schema.ts
// Define the Rings table
export type RingPeriod = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

export interface Ring {
  id?: number;
  name: string;
  period: RingPeriod;
  weekStartDay: number; // 0 = Sunday, 1 = Monday, ...
  activeDays: boolean[]; // [Sat, Sun, Mon, Tue, Wed, Thu, Fri]
  /**
   * «إتاحة التسميع في أيام الإجازة» — إن كانت مُطفأة (الافتراضي) فالتسميع
   * **مقفل** في أيام الإجازة، وإن أُشعلت أمكن للمعلّم سماع التسميع وتسجيل
   * التقييم فيها **دون** تحريك الموضع الجاري ⇒ فلا تزحف خطّة الأسبوع.
   */
  allowOffDayRecitation?: boolean;
}

// Attendance / preparation status for a student on the current session day
export type StudentStatus =
  | 'present' // حاضر
  | 'late' // متأخر
  | 'absent' // غائب
  | 'excused' // مستأذن
  | 'not_recited' // لم يحفظ
  | 'not_prepared'; // لم يُحضّر

// Define the Students table
export interface Student {
  id?: number;
  ringId: number;
  name: string;
  /** composed display label, e.g. «سادس ابتدائي» — kept for older records */
  level: string;
  /** المرحلة: ابتدائي | متوسط | ثانوي  (not indexed: no schema bump needed) */
  stage?: string;
  /** الصف داخل المرحلة: رابع…سادس / أول…ثالث */
  grade?: string;
  hifzTarget: number; // lines per day (حفظ)
  murajaahTarget: number; // pages per day (مراجعة)
  /** ---- محرّك التدرّج المنهجي (غير مفهرس ⇒ لا يحتاج ترقية مخطط) ---- */
  hifzStartSurah?: number; // بداية الحفظ: السورة
  hifzStartAyah?: number; // بداية الحفظ: رقم الآية
  hifzDirection?: ProgressDirection; // اتجاه سير الحفظ
  murajaahStartSurah?: number; // بداية المراجعة: السورة
  murajaahStartAyah?: number; // بداية المراجعة: رقم الآية
  murajaahDirection?: ProgressDirection; // اتجاه سير المراجعة
  /** الموضع الجاري للحفظ (يتقدّم مع كل تسليم) */
  currentSurah?: number;
  currentAyah?: number;
  /** الموضع الجاري للمراجعة */
  murajaahCurrentSurah?: number;
  murajaahCurrentAyah?: number;
  /** ⚡ ضبط نطاق المراجعة تلقائياً حسب المحفوظ */
  autoSyncRevision?: boolean;
  /** ⏸ إيقاف الحفظ مؤقتاً — الطالب للمراجعة فقط */
  hifzPaused?: boolean;
  /**
   * **نافذة الحفظ التراكمي (حفظ الربط)** — آخر مقطعين منجزين (الأقدم أولاً).
   * مهمّة اليوم = أقدمُهما ← نهاية مقطع اليوم الجديد، فيبقى المقطع مُكرَّراً
   * ثلاثة أيام عملٍ متتالية ثم يخرج من النافذة. تُحدَّث لحظة تسليم التسميع.
   */
  hifzWindow?: { from: { surah: number; ayah: number }; to: { surah: number; ayah: number } }[];
  /** ما بقي من أيام الإيقاف (تُنقص يوماً لكل يوم حلقة) */
  hifzPauseDays?: number;
  /** آخر تاريخ احتُسب فيه العدّاد (ISO yyyy-mm-dd) */
  hifzPauseStartedOn?: string;
  status: StudentStatus;
  lastUpdated: Date;
}

/** كيف انتهت جلسة اليوم: تسميع كامل، أو «لم يحفظ» */
export type DailyResult = 'recited' | 'not_recited';

/** اتجاه السير المنهجي (مصدره utils/progression) */
export type ProgressDirection = 'nas-to-baqarah' | 'baqarah-to-nas';

// Define the Sessions/History table
export interface Session {
  id?: number;
  studentId: number;
  date: Date;
  hifzLines: number;
  murajaahPages: number;
  score: number; // 0-20
  notes?: string;
  /** outcome of the day's session — older rows have no value (treated as recited) */
  result?: DailyResult;
  /** ---- نتيجة كل مادّة على حدة (حفظ / مراجعة) في هذا اليوم ---- */
  hifzResult?: DailyResult;
  hifzScore?: number;
  murajaahResult?: DailyResult;
  murajaahScore?: number;
  /**
   * **المقطع الفعلي** الذي سُمِع في هذا اليوم (لا المخطَّط) — وهو «المرساة» التي
   * تُعاد منها جدولة الأيام التالية: إن سُمِع ٤ أوجه من أصل ٥ فالغد يبدأ من
   * الخامس. صفوفٌ قديمة قد تخلو منها ⇒ تُقرأ من `notes` للعرض فقط.
   */
  hifzFrom?: { surah: number; ayah: number };
  hifzTo?: { surah: number; ayah: number };
  murajaahFrom?: { surah: number; ayah: number };
  murajaahTo?: { surah: number; ayah: number };
  createdAt: Date;
}

/** حضور طالب في يوم محدّد — يتيح المراجعة والتعديل بأثر رجعي */
export interface Attendance {
  id?: number;
  studentId: number;
  /** yyyy-mm-dd (مفهرس مع studentId) */
  date: string;
  status: StudentStatus;
  updatedAt: Date;
}

// Export table specifications for Dexie
export const tables: { [tableName: string]: string } = {
  rings: '++id, name, period, weekStartDay',
  students: '++id, ringId, name, level, hifzTarget, murajaahTarget, status, lastUpdated',
  sessions: '++id, studentId, date, hifzLines, murajaahPages, score, createdAt',
};

/** الإصدار ٢: أُضيف جدول الحضور اليومي (حضور لكل تاريخ) */
export const tablesV2: { [tableName: string]: string } = {
  ...tables,
  attendance: '++id, studentId, date, [studentId+date]',
};

// الإصدار ٣: **تنظيفٌ فقط** بمخطّطٍ كالإصدار ٢ حرفياً — لا فهرس فريد بعد!
// السبب: Dexie يبني الفهارس **قبل** تشغيل دالّة الترقية، فطلبُ فهرسٍ فريد على
// بياناتٍ فيها تكرار ⇒ يفشل بناء الفهرس ⇒ ينحبس فتح القاعدة كلّها. فنُرقّي
// أولاً بلا قيد (وتعمل الترقية على البيانات فتُنظّفها)، ثم نُضيف القيد في v4.
export const tablesV3: Record<string, string> = { ...tablesV2 };

// الإصدار ٤: قيد الفرادة الحقيقيّ — لا يُطلَب إلا بعد أن صارت البيانات نظيفة.
export const tablesV4: Record<string, string> = {
  ...tablesV2,
  attendance: '++id, studentId, date, &[studentId+date]',
};
