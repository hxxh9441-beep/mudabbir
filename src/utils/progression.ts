// src/utils/progression.ts
// محرّك التدرّج المنهجي لـ«مُدَبِّر».
//
// الفكرة: نقطة بداية (سورة/آية) + اتجاه سير + مقدار يومي (أسطر للحفظ، أوجه
// للمراجعة) ⇒ مهمّة اليوم كاملة، مع عبور حدود السور بسلاسة.
//
// البيانات من public/data/quran-curriculum.json (مضغوط ~17KB): أسماء السور
// وأعداد آياتها + فرق الصفحة لكل آية (0/1) — 6236 آية بترتيب المصحف.
import { LINES_PER_PAGE } from '../data/mushafData';

/** اتجاه السير المنهجي */
export type ProgressDirection = 'nas-to-baqarah' | 'baqarah-to-nas';

export interface SurahInfo {
  n: number; // رقم السورة 1..114
  name: string; // الاسم كاملاً «سُورَةُ النَّاسِ»
  key: string; // اسم مختصر بلا تشكيل «الناس» — للبحث والعرض
  ayahs: number; // عدد آياتها
  page: number | null; // أول صفحة فيها
}

export interface Curriculum {
  v: number;
  firstPage: number;
  totalAyahs: number;
  surahs: SurahInfo[];
  pageDeltas: string;
}

export interface Position {
  surah: number;
  ayah: number;
}

export interface Assignment {
  from: Position; // نقطة البداية في المهمّة
  to: Position; // آخر آية تصل إليها المهمّة
  ayahs: number; // عدد الآيات في المهمّة
  pages: number; // ما يعادلها بالأوجه (تقديري)
  pageFrom: number; // أول صفحة تمسّها المهمّة
  pageTo: number; // آخر صفحة تمسّها المهمّة
  nextStart: Position | null; // من أين يبدأ الغد (null = خُتم المصحف)
}

/** التسميات كما تظهر للمعلّم */
export const DIRECTION_LABEL: Record<ProgressDirection, string> = {
  'nas-to-baqarah': '⬆ من الناس إلى البقرة',
  'baqarah-to-nas': '⬇ من البقرة إلى الناس',
};
/** الوصف القصير داخل الأزرار على الجوال */
export const DIRECTION_SHORT: Record<ProgressDirection, string> = {
  'nas-to-baqarah': '⬆ نحو البقرة',
  'baqarah-to-nas': '⬇ نحو الناس',
};
/** نقطة البداية الطبيعية لكل اتجاه */
export const DIRECTION_START: Record<ProgressDirection, Position> = {
  'nas-to-baqarah': { surah: 114, ayah: 1 },
  'baqarah-to-nas': { surah: 2, ayah: 1 },
};

let cache: Curriculum | null = null;
let inflight: Promise<Curriculum> | null = null;
let starts: number[] | null = null; // أول فهرس عام لكل سورة
let pageOf: number[] | null = null; // رقم الصفحة لكل آية عامة
let countOfPage: number[] | null = null; // عدد آيات كل صفحة (مفهرس برقم الصفحة)

function surahStarts(c: Curriculum): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of c.surahs) {
    out.push(acc);
    acc += s.ayahs;
  }
  return out;
}

function buildPages(c: Curriculum) {
  const arr = new Array<number>(c.totalAyahs);
  let page = c.firstPage;
  for (let i = 0; i < c.totalAyahs; i++) {
    if (i > 0) page += Number(c.pageDeltas[i]) || 0;
    arr[i] = page;
  }
  pageOf = arr;
  const counts = new Array<number>(c.totalAyahs + 2).fill(0);
  for (const p of arr) counts[p] = (counts[p] ?? 0) + 1;
  countOfPage = counts;
}

export async function loadCurriculum(): Promise<Curriculum> {
  if (cache) return cache;
  if (inflight) return inflight;
  // BASE_URL يضبطه Vite حسب base: '/' محلياً، و«/<اسم-المستودع>/» على GitHub Pages.
  inflight = fetch(`${import.meta.env.BASE_URL}data/quran-curriculum.json`)
    .then((r) => {
      if (!r.ok) throw new Error('فشل تحميل فهرس المنهج');
      return r.json() as Promise<Curriculum>;
    })
    .then((c) => {
      cache = c;
      starts = surahStarts(c);
      buildPages(c);
      inflight = null;
      return c;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

export function curriculum(): Curriculum | null {
  return cache;
}

export const surahCount = () => cache?.surahs.length ?? 114;
/** كل السور (114) — لقوائم الاختيار الكاملة */
export const allSurahs = (): SurahInfo[] => cache?.surahs ?? [];
export const surahInfo = (n: number): SurahInfo | null => cache?.surahs[n - 1] ?? null;
export const surahLabel = (n: number): string => surahInfo(n)?.name ?? String(n);
export const surahShort = (n: number): string => surahInfo(n)?.key ?? String(n);
export const ayahCountOf = (n: number): number => surahInfo(n)?.ayahs ?? 0;

/** بحث مرن في أسماء السور (بلا تشكيل، مع توحيد الألف/الياء/التاء). */
export function searchSurahs(
  q: string,
  limit = 12,
  filter?: (s: SurahInfo) => boolean,
): SurahInfo[] {
  const c = cache;
  if (!c) return [];
  const pool = filter ? c.surahs.filter(filter) : c.surahs;
  const needle = q.trim().replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
  if (!needle) return pool.slice(0, limit);
  const norm = (s: string) =>
    s
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
      .replace(/\u0671|\u0623|\u0625|\u0622/g, '\u0627')
      .replace(/\u0649/g, '\u064A')
      .replace(/\u0629/g, '\u0647');
  const n2 = norm(needle);
  const hits = pool.filter(
    (s) => s.key.includes(n2) || norm(s.name).includes(n2) || String(s.n) === needle,
  );
  return hits.slice(0, limit);
}

/** الفهرس العام للآية (0-based) — يمثّل ترتيب المصحف كاملاً. */
export function globalIndex(surah: number, ayah: number): number | null {
  const c = cache;
  if (!c || !starts) return null;
  const info = c.surahs[surah - 1];
  if (!info || ayah < 1 || ayah > info.ayahs) return null;
  return starts[surah - 1] + ayah - 1;
}

/** عكس العملية: أي سورة/آية عند فهرس عام. */
export function positionAt(index: number): Position | null {
  const c = cache;
  if (!c || !starts) return null;
  if (index < 0 || index >= c.totalAyahs) return null;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { surah: lo + 1, ayah: index - starts[lo] + 1 };
}

export const pageOfIndex = (index: number): number | null => pageOf?.[index] ?? null;
export const pageOfPosition = (p: Position): number | null => {
  const i = globalIndex(p.surah, p.ayah);
  return i === null ? null : pageOfIndex(i);
};

/**
 * الخطوة التالية في التدرّج:
 *  • «البقرة → الناس» : ترتيب المصحف الطبيعي (آية ثم آية، سورة ثم سورة).
 *  • «الناس → البقرة» : داخل السورة نتقدّم بالآيات (1 ⇒ آخرها)، ثم ننتقل إلى
 *    السورة السابقة — فالعبور بين السور سلس بلا أي حالة خاصة.
 */
export function nextIndex(index: number, direction: ProgressDirection): number | null {
  if (!cache || !starts) return null;
  if (index < 0 || index >= cache.totalAyahs) return null;
  if (direction === 'baqarah-to-nas') {
    return index + 1 < cache.totalAyahs ? index + 1 : null;
  }
  const p = positionAt(index);
  if (!p) return null;
  const info = cache.surahs[p.surah - 1];
  if (p.ayah < info.ayahs) return index + 1; // الآية التالية في نفس السورة
  if (p.surah <= 2) return null; // بلغنا نهاية البقرة
  return starts[p.surah - 2]; // أول آية من السورة السابقة
}

/** حدود السير: تُحصر المهمّة في نطاق المحفوظ، ومع cycle تدور عند الطرف الآخر. */
export interface WalkBounds {
  minSurah: number;
  maxSurah: number;
  /** عند بلوغ طرف النطاق: دُر إلى الطرف المقابل بدل التوقّف (مراجعة دورية) */
  cycle?: boolean;
}

/**
 * الموضع التالي **مباشرةً** بعد موضع (خطوة آيةٍ واحدة) — بنفس منطق خطوة
 * `computeAssignment`: يحترم حدود المحفوظ، وعند الطرف يدور إن كان دوريّاً.
 * تُستعمل في إعادة الجدولة التكيّفية: بعد أن سُمِع حتى آية، يكون موضع الغد
 * هو الآية التالية لها بالضبط (لا أكثر ولا أقل).
 */
export function nextPosition(
  from: Position,
  direction: ProgressDirection,
  bounds?: WalkBounds,
): Position | null {
  if (!cache || !starts) return null;
  const idx = globalIndex(from.surah, from.ayah);
  if (idx === null) return null;
  const nx = nextIndex(idx, direction);
  const p = nx === null ? null : positionAt(nx);
  if (!bounds) return p;
  if (p && p.surah >= bounds.minSurah && p.surah <= bounds.maxSurah) return p;
  if (!bounds.cycle) return null;
  const wrap =
    direction === 'nas-to-baqarah'
      ? { surah: bounds.maxSurah, ayah: 1 } // بلغنا أدنى النطاق ⇒ نعود إلى أعلاه
      : { surah: bounds.minSurah, ayah: 1 }; // بلغنا أعلى النطاق ⇒ نعود إلى أدناه
  const wi = globalIndex(wrap.surah, wrap.ayah);
  return wi === null ? null : positionAt(wi);
}

/**
 * عدد الآيات من `from` إلى `to` **في ترتيب التدرّج** (شامل الطرفين).
 * لازمةٌ لقياس مقطعٍ بين حدّين معلومين (نافذة الربط · تأسيس جزء عمّ) بلا
 * إعادة حساب المقدار. تُعيد 0 إن لم يُصادَف الحدّ الآخر.
 */
export function distanceAlong(
  from: Position,
  to: Position,
  direction: ProgressDirection,
): number {
  if (!cache || !starts) return 0;
  const i0 = globalIndex(from.surah, from.ayah);
  const i1 = globalIndex(to.surah, to.ayah);
  if (i0 === null || i1 === null) return 0;
  if (i0 === i1) return 1;
  let i = i0;
  let n = 1;
  let guard = 0;
  while (i !== i1 && guard++ < cache.totalAyahs) {
    const nx = nextIndex(i, direction);
    if (nx === null) break;
    i = nx;
    n += 1;
  }
  return i === i1 ? n : 0;
}

/** المهمّة اليومية: نمشي آية آية في اتجاه السير ونستهلك «صفحات» حتى المقدار. */
export function computeAssignment(
  start: Position,
  direction: ProgressDirection,
  amount: number,
  unit: 'lines' | 'pages',
  bounds?: WalkBounds,
): Assignment | null {
  const c = cache;
  if (!c || !pageOf || !countOfPage) return null;
  const startIdx = globalIndex(start.surah, start.ayah);
  if (startIdx === null) return null;

  const targetPages =
    unit === 'lines' ? Math.max(0.05, amount || 0) / LINES_PER_PAGE : Math.max(0.05, amount || 0);

  const consume = (i: number) => {
    const pg = pageOf![i];
    return 1 / (countOfPage![pg] || 1); // حصة الآية من صفحتها
  };

  // خطوة واحدة في اتجاه السير، مع احترام حدود المحفوظ إن حُدِّدت.
  // وعند الخروج من النطاق: إمّا نتوقّف، أو ندور إلى الطرف المقابل (دوري).
  const step = (i: number): number | null => {
    const nx = nextIndex(i, direction);
    if (!bounds) return nx;
    const p = nx === null ? null : positionAt(nx);
    if (p && p.surah >= bounds.minSurah && p.surah <= bounds.maxSurah) return nx;
    if (!bounds.cycle) return null;
    const wrap =
      direction === 'nas-to-baqarah'
        ? { surah: bounds.maxSurah, ayah: 1 } // بلغنا أدنى النطاق ⇒ نعود إلى أعلاه
        : { surah: bounds.minSurah, ayah: 1 }; // بلغنا أعلى النطاق ⇒ نعود إلى أدناه
    return globalIndex(wrap.surah, wrap.ayah);
  };

  const EPS = 1e-9; // 15 × (1/15) يخرج أقل بقليل — فلا نُطيل المهمّة آية زائدة
  let i = startIdx;
  let end = startIdx;
  let walked = 1;
  let consumed = consume(startIdx);
  let guard = 0;
  // نطاق الصفحات: نتتبّع أدنى/أعلى فهرس ماررنا به — فالدوران (cycle) قد يعبر
  // من طرف النطاق إلى الطرف الآخر ولا يكفي فيه min/max لنقطتَي البداية والنهاية.
  let loIdx = startIdx;
  let hiIdx = startIdx;
  while (consumed < targetPages - EPS && guard++ < c.totalAyahs) {
    const nx = step(i);
    if (nx === null) break; // بلغنا أول/آخر ما في المصحف أو طرف النطاق
    i = end = nx;
    walked += 1;
    consumed += consume(nx);
    if (nx < loIdx) loIdx = nx;
    if (nx > hiIdx) hiIdx = nx;
  }

  const from = positionAt(startIdx);
  const to = positionAt(end);
  if (!from || !to) return null;
  const nextIdx = step(end);
  const lo = loIdx;
  const hi = hiIdx;

  return {
    from,
    to,
    ayahs: walked,
    pages: Math.round(consumed * 100) / 100,
    pageFrom: pageOf[lo],
    pageTo: pageOf[hi],
    nextStart: nextIdx === null ? null : positionAt(nextIdx),
  };
}

/** وصف مختصر للمهمّة: «من الناس ١ إلى الناس ٦». */
export function describeAssignment(a: Assignment): string {
  const f = `${surahShort(a.from.surah)} ${a.from.ayah}`;
  const t = `${surahShort(a.to.surah)} ${a.to.ayah}`;
  return a.from.surah === a.to.surah && a.from.ayah === a.to.ayah ? `الآية ${f}` : `من ${f} إلى ${t}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// نطاق المحفوظ: المراجعة لا تتجاوز ما حُفظ فعلاً.
// قاعدة الحدّ: **السورة التي يقف فيها الطالب هي «الدرس الجاري» ولا تُحتسب من
// المحفوظ المُتقَن حتى تُكمَل** (أي حتى ينصرف إلى السورة التالية في التدرّج).
// مثال: طالبٌ يتقدّم من الناس نحو البقرة ووصل الكهف ⇒ المُتقَن = «مريم ← الناس»،
// والكهف يُضاف إلى النطاق لحظة انتهائه (عند الانتقال إلى الإسراء).
// ─────────────────────────────────────────────────────────────────────────────

export interface MemorizedRange {
  /** أصغر رقم سورة في المحفوظ */
  minSurah: number;
  /** أكبر رقم سورة في المحفوظ */
  maxSurah: number;
  /** السورة التي يقف فيها الطالب (الدرس الجاري — خارج النطاق حتى تُكمَل) */
  boundarySurah: number;
  /** عدد الآيات المنجزة من السورة الجارية (للعرض فقط) */
  boundaryAyahs: number;
  /** هل يوجد محفوظ أصلاً؟ */
  empty: boolean;
}

/** الموضع الأبعد في اتجاه السير بين نقطتين (البداية والموضع الجاري). */
export function furtherPosition(
  a: Position,
  b: Position | null,
  direction: ProgressDirection,
): Position {
  if (!b) return a;
  if (direction === 'nas-to-baqarah') {
    if (b.surah < a.surah) return b;
    if (b.surah === a.surah && b.ayah > a.ayah) return b;
    return a;
  }
  if (b.surah > a.surah) return b;
  if (b.surah === a.surah && b.ayah > a.ayah) return b;
  return a;
}

/** المشي في نفس ترتيب التدرّج: من نقطة البداية حتى يختم المصحف. */
export function memorizedFrom(start: Position, direction: ProgressDirection): MemorizedRange {
  const boundarySurah = start.surah;
  const boundaryAyahs = Math.max(0, start.ayah - 1); // (الآية الحالية لم تُحفظ بعد)
  if (direction === 'nas-to-baqarah') {
    // المُتقَن: من السورة التالية للسورة الجارية إلى الناس (الكهف ⇒ مريم)
    const minSurah = boundarySurah + 1;
    if (minSurah > 114) {
      return { minSurah: 115, maxSurah: 0, boundarySurah, boundaryAyahs, empty: true };
    }
    return { minSurah, maxSurah: 114, boundarySurah, boundaryAyahs, empty: false };
  }
  // البقرة → الناس: المُتقَن من البقرة إلى السورة السابقة للسورة الجارية
  const maxSurah = boundarySurah - 1;
  if (maxSurah < 2) {
    return { minSurah: 1, maxSurah: 0, boundarySurah, boundaryAyahs, empty: true };
  }
  return { minSurah: 2, maxSurah, boundarySurah, boundaryAyahs, empty: false };
}

/** هل السورة داخل المحفوظ؟ */
export function inMemorized(surah: number, r: MemorizedRange): boolean {
  return !r.empty && surah >= r.minSurah && surah <= r.maxSurah;
}

/** أقصى آية يمكن اختيارها في سورة من نطاق المحفوظ (0 = غير محفوظة). */
export function maxAyahInMemorized(surah: number, r: MemorizedRange): number {
  if (!inMemorized(surah, r)) return 0;
  if (surah === r.boundarySurah) return r.boundaryAyahs;
  return ayahCountOf(surah);
}

/** توصيف النطاق مطابقاً لحدوده الفعلية: «مريم ← الناس». */
export function describeMemorized(r: MemorizedRange): string {
  if (r.empty) return 'لا يوجد محفوظ بعد';
  if (r.maxSurah === 114) {
    // اتجاه الناس → البقرة: النطاق [minSurah … الناس]
    if (r.minSurah === 114) return surahShort(114);
    return `${surahShort(r.minSurah)} ← ${surahShort(114)}`;
  }
  // اتجاه البقرة → الناس: النطاق [البقرة … maxSurah]
  if (r.maxSurah === 2) return surahShort(2);
  return `${surahShort(2)} ← ${surahShort(r.maxSurah)}`;
}

/** أول موضع في المحفوظ باتجاه السير (نقطة انطلاق المراجعة). */
export function firstMemorizedPosition(r: MemorizedRange, direction: ProgressDirection): Position | null {
  if (r.empty) return null;
  return direction === 'nas-to-baqarah'
    ? { surah: r.maxSurah, ayah: 1 } // الناس ١
    : { surah: r.minSurah, ayah: 1 }; // البقرة ١
}
