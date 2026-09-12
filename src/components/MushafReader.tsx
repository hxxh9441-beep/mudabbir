// src/components/MushafReader.tsx
// «المصحف الكامل» — قارئٌ مستقلّ للمصحف المدنيّ (٦٠٤ صفحات) من الصفحة الرئيسية.
//   • شريطٌ علويّ: رجوع + فهرس · العنوان وترقيم الصفحة · بحث + تبديل الثيم.
//   • سطرٌ ثانويّ: اسم السورة (يميناً) ورقم الجزء (يساراً) وأسهم التقليب.
//   • الصفحة نفسها بنموذج المصحف المطبوع (١٥ سطراً) — تُقاس لتلائم الشاشة.
//   • تصفّح بالأسهم واللمس، وفهرسٌ منسدل فيه بحثٌ بالاسم/النصّ وانتقالٌ برقم صفحة.
//   • آخِرُ صفحةٍ يُحفظ (الرابط + localStorage) فيعود القارئ حيث تركه المعلّم.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, List, Moon, Search, Sun, X } from 'lucide-react';
import {
  LINES_PER_PAGE,
  TOTAL_PAGES,
  loadMushaf,
  surahNameByNumber,
  surahsStartingInside,
  toArabicDigits,
} from '../data/mushafData';
import type { MushafAyah, MushafData, MushafPage } from '../data/mushafData';
import {
  AyahBadge,
  BasmalahLine,
  Diamond,
  PageNumber,
  SURAH_TITLE_SIZE,
  Triangle,
  buildRows,
  measureWordWidths,
  rowRefWidth,
  splitWaqf,
  wordsOf,
} from './MushafView';
import type { LineItem, PageRow } from './MushafView';
import { useThemeContext } from '../utils/theme';
import { navigate, parseRoute, readerHash } from '../utils/nav';

/** مقاس اسم السورة الأصلي في المصحف (px) — يُصغَّر تكيّفاً إن ضاق السطر. */
const SURAH_TITLE_SIZE_PX = parseInt(SURAH_TITLE_SIZE, 10) || 17;

const PAGE_KEY = 'mudabbir:reader:page';

/**
 * نسبة العرض التي يملؤها **أطول سطر في الصفحة**: ٩٤٪ — بهامش قراءةٍ صغير.
 * المقاس يُحسب **لكل صفحة** كما تفعل تطبيقات المصحف: تُقاس الصفحة على عرض
 * الشاشة فيكون الخطّ مريحاً وفاتحاً، و**يظلّ واحداً في أسطر الصفحة الخمسة عشر
 * كلها** — لا حسابَ لمقاسٍ لكل سطر (فذلك يُفسد وحدة الصفحة).
 * الاختلاف في عرض الأسطر تعالجه **التمددة بالمسافات** لا بمقياس الحروف.
 * صفحتا اللوحة (١ و٢) تُقاسان على طول أسطرهما فتخرجان أكبر — كما طُلب.
 */
const FILL_RATIO = 0.94;

/**
 * حدُّ «السطر الممتلئ»: ما بلغ ٨٠٪ من **عرض عمود القراءة** يُمدَّد إليه
 * (كتقليد المطبوع)، وما دونه — كسطور الفاتحة القصيرة وآخر سطر في كل سورة —
 * يُوسَّط **بلا تمدّد** (وهو قرار المعلّم: لا شدَّ للكلمات في الأسطر القصيرة).
 * القياس على العمود لا على أطول سطر في الصفحة، فلا تُشدّ الأسطر على شاشةٍ عريضة.
 */
const PAGE_FULL_RATIO = 0.8;

/** مسافة الصفحة: سطرٌ طبيعيّ للوحة (٢× الخطّ) وشبكة ١٥ سطراً لغيرها. */
const VIGNETTE_LEADING = 2;

/** أسماء الأجزاء الثلاثين (المصحف المدنيّ). */
const JUZ_NAMES = [
  'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر',
  'الثامن عشر', 'التاسع عشر', 'العشرون', 'الحادي والعشرون', 'الثاني والعشرون', 'الثالث والعشرون',
  'الرابع والعشرون', 'الخامس والعشرون', 'السادس والعشرون', 'السابع والعشرون', 'الثامن والعشرون',
  'التاسع والعشرون', 'الثلاثون',
];

/** حروفٌ للتشكيل والعلامات — تُنزع قبل البحث في نصّ الآيات. */
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const bare = (t: string) => t.replace(MARKS, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');

/** اسم السورة للعرض: بيانات المصحف تحمل «سُورَةُ ٱلْفَاتِحَةِ» — نُنقّيها إلى «الفاتحة».
 *  و«الِ عِمْرَان» في البيانات تُعرض باسمها المعروف «آل عمران». */
const displayName = (raw?: string | null): string =>
  (raw ?? '')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0671/g, 'ا')
    .replace(/^سورة\s+/, '')
    .replace(/^ال عمران$/, 'آل عمران')
    .trim();

interface SurahEntry {
  n: number;
  name: string;
  ayahs: number;
  first: number;
  last: number;
  juz: number;
}

/**
 * فواصل أسطر صفحتَي اللوحة **كما في المطبوع المدنيّ** — لكل سطر: قائمة
 * [رقم الآية، عدد كلماتها في هذا السطر].
 *
 * الأساس: النصّ **يتدفّق تدفّقاً مستمرّاً** ولا يتوقّف عند حدّ الآية — تنتهي
 * الآية بميداليتها في وسط السطر ويمضي ما بعدها فيه. مثال الفاتحة كما ضبطها
 * المعلّم حرفاً:
 *   «بسم الله الرحمن الرحيم۝ / الحمد لله رب العالمين۝ /
 *    الرحمن الرحيم۝مالك يوم الدين۝ / إياك نعبد وإياك نستعين۝اهدنا /
 *    الصراط المستقيم۝صراط الذين أنعمت / عليهم غير المغضوب عليهم /
 *    ولا الضالين﴾»
 * لا توازنَ حسابيّاً هنا: الحدودُ منقولةٌ كما في المطبوع، ومجموع كلمات كل آية
 * في الجدول = مجموع كلماتها في بياناتنا بالضبط (تحقّقٌ آليّ يمنع خطأ النقل).
 */
const PRINTED_BREAKS: Record<number, Array<Array<[number, number]>>> = {
  1: [
    [[1, 4]],
    [[2, 4]],
    [[3, 2], [4, 3]],
    [[5, 4], [6, 1]],
    [[6, 2], [7, 3]],
    [[7, 4]],
    [[7, 2]],
  ],
  2: [
    [[1, 1], [2, 6]],
    [[2, 1], [3, 5]],
    [[3, 3], [4, 4]],
    [[4, 8]],
    [[5, 6]],
    [[5, 2]],
  ],
};

/**
 * أسطر صفحة اللوحة بفواصل المطبوع (لا بالتوازن الحسابيّ): إطارٌ ⇒ بسملةٌ ⇒
 * الأسطر كما هي، وكل سطرٍ مُوسَّط، والميدالية في موضع ختمِ الآية.
 */
function printedRows(page: MushafPage, breaks: Array<Array<[number, number]>>): PageRow[] {
  const rows: PageRow[] = [];
  for (const ay of page.a) {
    if (ay.n === 1) {
      rows.push({ kind: 'band', surah: ay.s });
      if (ay.s !== 1 && ay.s !== 9) rows.push({ kind: 'basmalah', surah: ay.s });
    }
  }
  const idx = new Map<number, { ay: MushafAyah; words: string[]; used: number }>();
  for (const ay of page.a) idx.set(ay.n, { ay, words: wordsOf(ay.t ?? ''), used: 0 });

  for (const line of breaks) {
    const tokens: LineItem[] = [];
    for (const [n, count] of line) {
      const e = idx.get(n);
      if (!e) continue;
      const slice = e.words.slice(e.used, e.used + count);
      slice.forEach((w, i) =>
        tokens.push({ kind: 'word', ayah: e.ay, text: w, wordKey: `${e.ay.s}:${n}:${e.used + i}` }),
      );
      e.used += slice.length;
      // الميدالية تلحق بمكان ختم الآية في السطر
      if (e.used >= e.words.length) tokens.push({ kind: 'marker', ayah: e.ay });
    }
    // لا نُثبّت التوسيط: قاعدة الامتلاء هي التي تقرّر (سطرٌ ممتلئ يُمدَّد،
    // وقصيرٌ يُوسَّط) — كما في المطبوع تماماً.
    if (tokens.length) rows.push({ kind: 'text', tokens });
  }
  return rows;
}

interface Props {
  /** الصفحة المطلوبة من الرابط (#/mushaf/:page) */
  initialPage?: number;
  onBack: () => void;
}

/**
 * سطر اسم السورة: **الاسم وحده بين هلالين** — بلا إطارٍ ولا ميداليات ولا خطوط
 * زخرفيّة (بأمر المعلّم)، والصفّ يبقى على ارتفاعه فلا يتغيّر تخطيط الصفحة.
 */
function SurahTitle({
  name,
  rowPx,
  titleCap = SURAH_TITLE_SIZE_PX,
}: {
  name: string;
  rowPx: number;
  /** سقف حجم الاسم: ١٧px في صفحات المصحف، ويسمح بالكبر في صفحتَي اللوحة. */
  titleCap?: number;
}) {
  const fs = Math.max(10, Math.min(titleCap, Math.round(rowPx * 0.5)));
  return (
    <span
      className="font-mushaf block whitespace-nowrap text-center font-semibold leading-snug"
      style={{ fontSize: fs }}
    >
      ( {name} )
    </span>
  );
}

// رقم الصفحة يُعرض في المتن نفسه: بين هلالين، في **منتصف أسفل الصفحة** —
// بلا إطارٍ ولا زخرفة حوله (كتقليد المطبوع المدنيّ)، والهلالان يأتيان من
// مكوّن PageNumber نفسه.

export default function MushafReader({ initialPage, onBack }: Props) {
  const { isDark, toggle } = useThemeContext();

  const [data, setData] = useState<MushafData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState<number>(() => {
    if (initialPage && initialPage >= 1 && initialPage <= TOTAL_PAGES) return initialPage;
    try {
      const saved = Number(localStorage.getItem(PAGE_KEY));
      if (Number.isFinite(saved) && saved >= 1 && saved <= TOTAL_PAGES) return saved;
    } catch {
      /* لا شيء */
    }
    return 1;
  });
  const [indexOpen, setIndexOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [jumpVal, setJumpVal] = useState('');
  const [fontPx, setFontPx] = useState(20);
  const [rowPx, setRowPx] = useState(30);
  const [colMax, setColMax] = useState<number | null>(null);
  /** عرض عمود القراءة الفعلي على الشاشة (px) — يُقاس في جولة الضبط */
  const [colPx, setColPx] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [fitTick, setFitTick] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  /** مقدار السحب اللحظيّ (px) — نُطلقه في حركة استقرار الصفحة الجديدة */
  const dragX = useRef(0);
  /** اتّجاه آخر تنقّل (next/prev) لتُشغَّل الحركة مرّة واحدة عند تغيّر الصفحة */
  const turnDir = useRef<'next' | 'prev' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadMushaf()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setLoadErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  // تحميل خطّ المصحف: لا يكفي `document.fonts.ready` — فمع `font-display: swap`
  // قد يقع التبديل **بعد** قياس عرض الكلمات، فتُحسب الملاءمة على مقاسات الخطّ
  // البديل ثم يتغيّر العرض فيفيض السطر (رصدنا ١٠٩٪ بهذه العلّة). فنُجبر تحميل
  // الوجه بمحارف القياس كلها (حروفاً وعلاماتٍ)، ثم نُعيد جولة الملاءمة.
  useEffect(() => {
    let alive = true;
    const done = () => {
      if (!alive) return;
      setFontsReady(true);
      setFitTick((t) => t + 1);
    };
    const fonts = document.fonts;
    if (!fonts) {
      done();
      return;
    }
    const probe = '\u0670\u0671\u06D6\u06DA\u06DE\u06DF\u06E0\u06E2\u06E3\u06E5\u06E6\u06E9\u06EB\u06ED\u064E\u0651';
    Promise.all([
      fonts.load('20px "Quran Text"', probe),
      fonts.load('20px "Quran Text"', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'),
    ])
      .catch(() => {})
      .finally(done);
    fonts.addEventListener('loadingdone', done);
    return () => {
      alive = false;
      fonts.removeEventListener('loadingdone', done);
    };
  }, []);

  // ── ثبات الموضع: الرابط يحمل الصفحة (بلا تكديس تاريخٍ) + localStorage ──
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, String(pageNum));
    } catch {
      /* لا شيء */
    }
    const want = readerHash(pageNum);
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  }, [pageNum]);

  // الرابط يقود الصفحة عند تغيّره من خارج القارئ (زرّ الرجوع/التقدّم، أو تعديل
  // الرابط يدوياً أو وسم #/mushaf/:page) — فلا يخالف المعروضُ الرابطَ أبداً.
  useEffect(() => {
    if (initialPage && initialPage >= 1 && initialPage <= TOTAL_PAGES && initialPage !== pageNum) {
      setPageNum(initialPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage]);

  // ومستمعُ hashchange مباشرةً: لو كان الرابط يطلب صفحةً هي نفسها قيمةُ الحالة
  // في الأب (فلا تتغيّر الخاصية) — كأن يعدّل المستخدم الرابط يدوياً إلى صفحة
  // كان الأب يحملها أصلاً — فإنّ React لا يُعيد الرسم، فنتابع الرابط هنا.
  useEffect(() => {
    const onHash = () => {
      const r = parseRoute(window.location.hash);
      if (r.view === 'reader' && r.page && r.page >= 1 && r.page <= TOTAL_PAGES) {
        setPageNum((cur) => (cur === r.page ? cur : (r.page as number)));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const page: MushafPage | null = data ? (data.pages[pageNum - 1] ?? null) : null;


  const goPrev = useCallback(() => {
    turnDir.current = 'prev';
    setPageNum((p) => Math.max(1, p - 1));
  }, []);
  const goNext = useCallback(() => {
    turnDir.current = 'next';
    setPageNum((p) => Math.min(TOTAL_PAGES, p + 1));
  }, []);

  /**
   * **حركة قلب الصفحة** — خفيفة ومن غير إعادة رسم:
   * تُضبط على العنصر مباشرةً بـ`transform/opacity` (خصائص يُنفّذها المسرّع
   * الرسوميّ فلا تُثقل الإيماءة ولا تحجب التفاعل).
   *   • بعد سحبٍ: الصفحة الجديدة تستقرّ من حيثُ تركها الإصبع (لا قفزة).
   *   • بعد زرٍّ أو لوحة مفاتيح: تبدأ من إزاحة ١٨px باتّجاه مناسب ثم تنزلق.
   * وتُحترم رغبة تقليل الحركة (`prefers-reduced-motion`).
   */
  useEffect(() => {
    const dir = turnDir.current;
    turnDir.current = null;
    const el = bodyRef.current;
    if (!el) return;
    if (!dir || reducedMotion()) {
      dragX.current = 0;
      el.style.transition = 'none';
      el.style.transform = 'translateX(0)';
      el.style.opacity = '1';
      return;
    }
    const dragged = dragX.current;
    dragX.current = 0;
    if (Math.abs(dragged) < 1) {
      // لا سحب ⇒ ابدأ من إزاحة صغيرة شبه شفّافة ثم انزلق إلى موضعك
      el.style.transition = 'none';
      el.style.transform = `translateX(${dir === 'next' ? -18 : 18}px)`;
      el.style.opacity = '0.55';
      void el.offsetWidth; // إجبار التدفّق ليُحسب هذا كحالةٍ ابتدائيّة
    }
    el.style.transition = 'transform 220ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease';
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum]);

  // لوحة المفاتيح: الاتّجاه نفسه اتّجاه الإيماءة — الصفحة تتبع الجهة التي تدفعها
  // (يميناً ⇒ التالية، يساراً ⇒ السابقة) مع بقاء Esc والأزرار كما هي.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (indexOpen) {
        if (e.key === 'Escape') setIndexOpen(false);
        return;
      }
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext, indexOpen, onBack]);

  // ── أسطر الصفحة: فواصل السور + البسملات + الآيات (١٥ سطراً) ──
  const widths = useMemo(() => (page && fontsReady ? measureWordWidths(page) : undefined), [page, fontsReady]);
  /**
   * صفحتا الفاتحة وبداية البقرة لوحةٌ في المطبوع: أسطرُهما **منقولةٌ كما هي**
   * (فواصل المطبوع، مُوسَّطة، والميدالية موضع ختم الآية) — لا شبكةَ ١٥ ولا
   * توازناً حسابيّاً يخالف المطبوع. وباقي الصفحات على محرّك ١٥ سطراً نفسه.
   */
  const breaks = pageNum <= 2 ? PRINTED_BREAKS[pageNum] : undefined;
  /** صفحتا اللوحة: لا تقسيمٍ على ١٥ سطراً كذلك الذي في باقي الصفحات */
  const natural = !!breaks;
  const rows: PageRow[] = useMemo(
    () => (page ? (breaks ? printedRows(page, breaks) : buildRows(page, widths)) : []),
    [page, widths, breaks],
  );
  const rowRefs = useMemo(() => rows.map((r) => rowRefWidth(r, widths)), [rows, widths]);
  const maxRef = useMemo(() => rowRefs.reduce((m, v) => Math.max(m, v), 0), [rowRefs]);

  // ── ملاءمة الصفحة للشاشة: حجم خطٍّ واحد يملأ العرض والارتفاع ──
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !rows.length) return;
    const raf = requestAnimationFrame(() => {
      const vw = window.innerWidth;
      let widestRow = 0;
      for (const r of Array.from(body.querySelectorAll<HTMLElement>('.mushaf-line'))) {
        let w = 0;
        for (const el of Array.from(r.children)) w += (el as HTMLElement).getBoundingClientRect().width;
        widestRow = Math.max(widestRow, w);
      }
      if (!widestRow) return;
      const PAD = 24;
      const availW = Math.max(120, vw - PAD);
      const evenRow = Math.max(12, Math.floor(body.clientHeight / LINES_PER_PAGE));
      const rowCount = Math.max(1, rows.length);
      // ① العرض: **أطول سطرٍ في هذه الصفحة** يملأ ٩٤٪ من عرض القراءة ⇒ الصفحة
      //    كلها بمقاسٍ مريح يملأ الشاشة (كما تفعل تطبيقات المصحف)، والمقاس
      //    نفسه يُطبَّق على الأسطر الخمسة عشر كلها — لا مقاسَ لكل سطر.
      //    (widestRow مقيسٌ بمقاس الخطّ الحالي fontPx — فنُسقِطه على العرض.)
      const byWidth = Math.max(9, Math.floor((availW * FILL_RATIO * fontPx) / widestRow));
      // ② الرأس: ألّا يزيد الخطّ عمّا يسع الصفحة — شبكةُ ١٥ سطراً في الصفحات
      //    العادية، أو ارتفاعُ أسطر اللوحة (١.٧٥×) في صفحتَي الفاتحة والبقرة.
      const byHeight = natural
        ? Math.floor(body.clientHeight / (rowCount * VIGNETTE_LEADING))
        : Math.floor(evenRow / 1.5);
      const next = Math.max(9, Math.min(64, byWidth, byHeight));
      setFontPx(next);
      // ③ المسافة الرأسية: شبكة ١٥ سطراً تتوزّع على كامل ارتفاع القراءة،
      //    ولوحة الفاتحة/البقرة تتّسع مسافتها لتكبر مع خطّها فتكون بارزة.
      setRowPx(natural ? Math.max(20, Math.round(next * VIGNETTE_LEADING)) : evenRow);
      // ④ عرض عمود القراءة: **يعانق النصّ** بمقاسه الجديد (أوسع سطر ÷ ٠.٩٤)
      //    فلا تتباعد الكلمات على الشاشات العريضة — وعلى الجوال يبلغ العمود
      //    عرض الشاشة كاملاً بهامشٍ صغير (لأنّ المقاس اشتُقّ من العرض نفسه).
      const capped = Math.max(
        160,
        Math.min(vw, Math.ceil((widestRow * next) / fontPx / FILL_RATIO) + 8),
      );
      setColMax((prev) => (prev !== null && Math.abs(prev - capped) < 3 ? prev : capped));
      const innerW = Math.max(80, body.clientWidth - 8); // px-1 على المتن
      setColPx((prev) => (Math.abs(prev - innerW) < 2 ? prev : innerW));
    });
    return () => cancelAnimationFrame(raf);
  }, [rows, pageNum, fitTick, fontPx, natural]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFitTick((t) => t + 1));
    ro.observe(body);
    return () => ro.disconnect();
  }, [data]);

  // ── قائمة السور (الاسم · عدد الآيات · الصفحات · الجزء) من بيانات المصحف ──
  const surahs: SurahEntry[] = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, SurahEntry>();
    for (const pg of data.pages) {
      for (const ay of pg.a) {
        const e = map.get(ay.s);
        if (!e) {
          map.set(ay.s, {
            n: ay.s,
            name: displayName(surahNameByNumber(ay.s)),
            ayahs: ay.n,
            first: pg.p,
            last: pg.p,
            juz: pg.j,
          });
        } else {
          e.ayahs = Math.max(e.ayahs, ay.n);
          e.last = pg.p;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.n - b.n);
  }, [data]);

  // السورة المعروضة: السورة التي تبدأ في الصفحة (وإن كانت تبدأ في أثنائها) —
  // فمَن انتقل من الفهرس إلى الكهف يرى «الكهف» لا سورة الصفحة السابقة.
  const startSurahs = page ? surahsStartingInside(page) : [];
  const currentSurah = startSurahs.length ? startSurahs[startSurahs.length - 1] : (page?.a[0]?.s ?? 1);
  const currentJuz = page?.j ?? 1;

  // ── الفهرسة: مطابقة السور بالاسم/الرقم + مطابقة نصّ الآيات ──
  const q = bare(query.trim().toLowerCase());
  const surahHits = useMemo(() => {
    if (!q) return surahs;
    return surahs.filter(
      (s) => bare(s.name).includes(q) || String(s.n) === q || toArabicDigits(s.n) === query.trim(),
    );
  }, [q, surahs, query]);

  const ayahHits = useMemo(() => {
    if (!data || q.length < 3) return [];
    const out: { surah: number; ayah: number; page: number; text: string }[] = [];
    for (const pg of data.pages) {
      for (const ay of pg.a) {
        if (!ay.t) continue;
        if (bare(ay.t).includes(q)) {
          out.push({ surah: ay.s, ayah: ay.n, page: pg.p, text: ay.t });
          if (out.length >= 24) return out;
        }
      }
    }
    return out;
  }, [data, q]);

  const jumpTo = useCallback(
    (p: number) => {
      const n = Math.max(1, Math.min(TOTAL_PAGES, Math.round(p)));
      setPageNum(n);
      setIndexOpen(false);
      setJumpVal('');
    },
    [],
  );

  /**
   * **إيماءة قلب الصفحة باتفاقيّة المصحف الورقيّ (RTL)**:
   *   • السحب إلى **اليمين** (dx موجب) ⇒ الصفحة **التالية**.
   *   • السحب إلى **اليسار** (dx سالب) ⇒ الصفحة **السابقة**.
   * كما يُقلب المصحف بين اليدين: يُلتقط حرفُ الصفحة الأيسر فتُقلب نحو اليمين
   * للتقدّم. (وهذا عكس ما كان — راجعه المعلّم على الصفحة ١.)
   * العتبة ٤٥px تفصل السحب عن اللمس، ويتبع النصّ الإصبع أثناء السحب (حزامٌ
   * مطاطيّ ٠.٣٥) ثم يستقرّ بحركة ٢٢٠ms — ويتلاشى قليلاً ليكون الانتقال مقروءاً.
   */
  const SWIPE_MIN = 45;
  const DRAG_FOLLOW = 0.35; // النصّ يتبع الإصبع بجزءٍ من المسافة (إحساس أصليّ)
  const reducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** يضبط موضع/شفافيّة متن الصفحة مباشرةً على العنصر (بلا إعادة رسم ⇒ بلا تقطيع). */
  const setPageShift = (px: number, opacity: number, animate: boolean) => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.transition = animate
      ? 'transform 220ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease'
      : 'none';
    el.style.transform = px === 0 ? 'translateX(0)' : `translateX(${px.toFixed(1)}px)`;
    el.style.opacity = String(opacity);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
    setPageShift(0, 1, false);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.touches[0].clientX - touchX.current;
    dragX.current = dx;
    // كلّما بعُد الإصبع خفّ النصّ قليلاً — تغذيةٌ بصريّة للاتّجاه
    const damp = Math.min(1, Math.abs(dx) / 220);
    setPageShift(dx * DRAG_FOLLOW, 1 - damp * 0.35, false);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < SWIPE_MIN) {
      // لم تكتمل الإيماءة: ارجع للموضع الطبيعي بهدوء
      dragX.current = 0;
      setPageShift(0, 1, true);
      return;
    }
    // نترك الموضع كما تركه الإصبع؛ تتولّى حركة تغيير الصفحة استقراره
    dragX.current = dx;
    if (dx > 0) goNext(); // يميناً ⇒ التالية
    else goPrev(); // يساراً ⇒ السابقة
  };

  if (loadErr) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
        <p className="text-rose-300">{loadErr}</p>
        <button onClick={onBack} className="press rounded-xl bg-white/10 px-4 py-2 text-white">
          رجوع
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex h-screen flex-col overflow-hidden bg-[#FAF7EE] text-[#1E140A] supports-[height:100dvh]:h-[100dvh] dark:bg-black dark:text-[#EAE5D9]">
      {/* ===== شريط التطبيق ===== */}
      <header className="shrink-0 border-b border-black/5 bg-[#F5EFEB]/90 px-2 py-1.5 backdrop-blur-xl dark:border-white/10 dark:bg-[#120D0A]/90">
        <div className="flex items-center justify-between gap-1.5">
          {/* يمين: رجوع + فهرس */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onBack}
              aria-label="رجوع"
              className="press flex h-10 w-10 items-center justify-center rounded-full text-[#5A4636] transition-colors hover:bg-black/5 dark:text-amber-100/80 dark:hover:bg-white/10"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                setIndexOpen(true);
                setQuery('');
              }}
              aria-label="فهرس المصحف"
              className="press flex h-10 w-10 items-center justify-center rounded-full text-[#5A4636] transition-colors hover:bg-black/5 dark:text-amber-100/80 dark:hover:bg-white/10"
            >
              <List className="h-5 w-5" />
            </button>
          </div>

          {/* الوسط: العنوان + ترقيم الصفحة */}
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-extrabold leading-tight">المصحف الكامل</p>
            <p className="text-[11px] font-bold leading-tight text-[#6B5B4A] dark:text-amber-100/60">
              صفحة {toArabicDigits(pageNum)} من {toArabicDigits(TOTAL_PAGES)}
            </p>
          </div>

          {/* يسار: بحث + ثيم */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => {
                setIndexOpen(true);
                setQuery('');
                setTimeout(() => searchRef.current?.focus(), 60);
              }}
              aria-label="بحث في السور والآيات"
              className="press flex h-10 w-10 items-center justify-center rounded-full text-[#5A4636] transition-colors hover:bg-black/5 dark:text-amber-100/80 dark:hover:bg-white/10"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              onClick={toggle}
              aria-label={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
              className="press flex h-10 w-10 items-center justify-center rounded-full text-[#5A4636] transition-colors hover:bg-black/5 dark:text-amber-100/80 dark:hover:bg-white/10"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* السطر الثانوي: السورة (يميناً) · التقليب · الجزء (يساراً) */}
      </header>

      {/* ===== الصفحة نفسها (بلا كرتٍ ولا إطار) ===== */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <div
          style={{ maxWidth: colMax ?? 544 }}
          className="mx-auto flex min-h-0 w-full flex-1 flex-col px-[10px] pt-1 pb-1"
        >
          {!data || !page ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="animate-pulse opacity-70">جارٍ تحميل المصحف…</p>
            </div>
          ) : (
            <>
              {/* ترويسة الصفحة (كما في المطبوع): الجزء يميناً · اسم السورة يساراً */}
              <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 pb-0.5 text-[0.78rem] font-bold opacity-80 sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <span>الجزء {JUZ_NAMES[currentJuz - 1] ?? toArabicDigits(currentJuz)}</span>
                  <Diamond size={4} className="mushaf-orn shrink-0 opacity-70" />
                </span>
                <span className="flex items-center gap-1.5">
                  <Diamond size={4} className="mushaf-orn shrink-0 opacity-70" />
                  <span>{displayName(surahNameByNumber(currentSurah))}</span>
                </span>
              </div>
              {/* خيطٌ زخرفيّ رقيق تحت الترويسة (كتقليد المطبوع) */}
              <div className="mushaf-orn-soft mx-2 mb-1 flex shrink-0 items-center gap-1.5 opacity-40">
                <span className="h-px flex-1 bg-current" />
                <Diamond size={4} className="shrink-0" />
                <span className="h-px flex-1 bg-current" />
              </div>
              <div
                ref={bodyRef}
                dir="rtl"
                className="relative flex min-h-0 flex-1 flex-col justify-center px-1"
              >
                {rows.map((row, li) => {
                  if (row.kind === 'band') {
                    const nm = surahNameByNumber(row.surah);
                    return (
                      <div
                        key={`band-${row.surah}`}
                        className="mushaf-row flex w-full shrink-0 items-center justify-center"
                        style={{ height: `${rowPx}px`, fontSize: `${fontPx}px`, lineHeight: 1 }}
                      >
                        {nm ? <SurahTitle name={nm} rowPx={rowPx} titleCap={natural ? 24 : SURAH_TITLE_SIZE_PX} /> : null}
                      </div>
                    );
                  }
                  if (row.kind === 'basmalah') {
                    return (
                      <div
                        key={`bas-${row.surah}`}
                        className="mushaf-row flex w-full shrink-0 items-center justify-center"
                        style={{ height: `${rowPx}px`, fontSize: `${fontPx}px`, lineHeight: 1 }}
                      >
                        <BasmalahLine />
                      </div>
                    );
                  }
                  const ref = rowRefs[li] ?? 0;
                  // عرضُ السطر الطبيعي بالبكسل (وحدات المرجع × مقاس الخطّ) مقابل
                  // عرض عمود القراءة **الفعلي**: ما بلغ ٨٠٪ منه يُمدَّد إلى العمود
                  // (كتقليد المطبوع)، وما دونه يُوسَّط. فلا تُمدَّد الأسطر على شاشةٍ
                  // عريضة (فيتباعد الكلمات)، ولا تبقى ناقصةً على الجوال.
                  const naturalPx = (ref * fontPx) / 100;
                  const colPx2 = colPx || colMax || 320;
                  const centered = !!row.centered || naturalPx < colPx2 * PAGE_FULL_RATIO;
                  return (
                    <div
                      key={`t-${li}`}
                      data-fill={maxRef > 0 ? Math.round((ref / maxRef) * 100) : 0}
                      className={`mushaf-line flex w-full shrink-0 items-center whitespace-nowrap ${
                        centered ? 'justify-center' : 'justify-between'
                      }`}
                      style={{ fontSize: `${fontPx}px`, height: `${rowPx}px`, lineHeight: 1 }}
                    >
                      {row.tokens.map((t) => {
                        if (t.kind === 'word') {
                          const [body, waqf] = splitWaqf(t.text ?? '');
                          return (
                            <span
                              key={t.wordKey}
                              className="font-quran inline-block shrink-0 whitespace-nowrap px-[0.04em] tracking-normal"
                            >
                              {body}
                              {waqf ? <span className="mushaf-waqf">{waqf}</span> : null}
                            </span>
                          );
                        }
                        const h = Math.max(16, Math.round(fontPx * 1.48));
                        return (
                          <span
                            key={`m-${t.ayah.s}:${t.ayah.n}`}
                            className="mushaf-orn mx-[0.12em] shrink-0 leading-none"
                          >
                            <span className="block">
                              <AyahBadge n={t.ayah.n} h={h} />
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {/* السطر الأخير: رقم الصفحة بين هلالين **في منتصف أسفل الصفحة**،
                  وسهمَا التقليب يميناً (RTL: الابن الأول أقصى اليمين). */}
              <div className="relative flex shrink-0 items-center justify-start pt-0.5">
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={goPrev}
                    disabled={pageNum <= 1}
                    aria-label={`الصفحة السابقة${pageNum > 1 ? ` — ${toArabicDigits(pageNum - 1)}` : ''}`}
                    title={`الصفحة السابقة${pageNum > 1 ? ` — ${toArabicDigits(pageNum - 1)}` : ''}`}
                    className="press flex h-9 w-9 items-center justify-center rounded-lg text-[#8a6508] transition-colors hover:bg-black/5 disabled:opacity-25 dark:text-amber-300 dark:hover:bg-white/10"
                  >
                    <Triangle dir="right" size={16} />
                  </button>
                  <button
                    onClick={goNext}
                    disabled={pageNum >= TOTAL_PAGES}
                    aria-label={`الصفحة التالية${
                      pageNum < TOTAL_PAGES ? ` — ${toArabicDigits(pageNum + 1)}` : ''
                    }`}
                    title={`الصفحة التالية${pageNum < TOTAL_PAGES ? ` — ${toArabicDigits(pageNum + 1)}` : ''}`}
                    className="press flex h-9 w-9 items-center justify-center rounded-lg text-[#8a6508] transition-colors hover:bg-black/5 disabled:opacity-25 dark:text-amber-300 dark:hover:bg-white/10"
                  >
                    <Triangle dir="left" size={16} />
                  </button>
                </span>
                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2">
                  <PageNumber n={page.p} className="text-[0.9rem] opacity-75" />
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== فهرس المصحف (لوحٌ منسدل) ===== */}
      {indexOpen && (
        <div className="fixed inset-0 z-[80] flex" role="dialog" aria-label="فهرس المصحف">
          <button
            aria-label="إغلاق الفهرس"
            onClick={() => setIndexOpen(false)}
            className="flex-1 bg-black/40 backdrop-blur-sm"
          />
          <div className="flex h-full w-[88%] max-w-md flex-col border-s border-black/10 bg-[#FAF7EE] shadow-2xl dark:border-white/10 dark:bg-[#161009]">
            <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
              <p className="text-base font-extrabold">فهرس المصحف</p>
              <button
                onClick={() => setIndexOpen(false)}
                aria-label="إغلاق"
                className="press flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
              <div className="flex items-center gap-2 rounded-xl bg-black/5 px-2.5 py-1.5 dark:bg-white/5">
                <Search className="h-4 w-4 shrink-0 opacity-60" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث عن سورة بالاسم أو رقمها…"
                  className="w-full bg-transparent text-sm font-semibold outline-none placeholder:opacity-50"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="مسح البحث" className="press opacity-60">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={jumpVal}
                  onChange={(e) => setJumpVal(e.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && jumpTo(Number(jumpVal))}
                  inputMode="numeric"
                  placeholder={`رقم الصفحة (١ - ${toArabicDigits(TOTAL_PAGES)})`}
                  aria-label="رقم الصفحة"
                  className="w-full rounded-xl bg-black/5 px-2.5 py-2 text-sm font-bold outline-none placeholder:opacity-50 dark:bg-white/5"
                />
                <button
                  onClick={() => jumpTo(Number(jumpVal))}
                  disabled={!jumpVal}
                  className="press shrink-0 rounded-xl bg-[#B8860B] px-3 py-2 text-sm font-extrabold text-white disabled:opacity-40"
                >
                  انتقل
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
              {/* نتائج السور */}
              {surahHits.length === 0 && ayahHits.length === 0 ? (
                <p className="py-8 text-center text-sm font-semibold opacity-60">لا نتائج</p>
              ) : (
                <>
                  {surahHits.map((s) => {
                    const active = s.n === currentSurah;
                    return (
                      <button
                        key={s.n}
                        onClick={() => jumpTo(s.first)}
                        className={`press mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-right transition-colors ${
                          active
                            ? 'bg-[#B8860B]/15 ring-1 ring-inset ring-[#B8860B]/40'
                            : 'hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/5 text-xs font-extrabold dark:bg-white/10">
                          {toArabicDigits(s.n)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-extrabold">سورة {s.name}</span>
                            {active && (
                              <span className="shrink-0 rounded-full bg-[#B8860B]/20 px-1.5 py-0.5 text-[10px] font-extrabold text-[#8a6508] dark:text-amber-300">
                                الحالية
                              </span>
                            )}
                          </span>
                          <span className="block text-[11px] font-semibold opacity-65">
                            {toArabicDigits(s.ayahs)} آية · صفحة {toArabicDigits(s.first)}
                            {s.last !== s.first ? ` - ${toArabicDigits(s.last)}` : ''} · الجزء{' '}
                            {JUZ_NAMES[s.juz - 1] ?? toArabicDigits(s.juz)}
                          </span>
                        </span>
                      </button>
                    );
                  })}

                  {/* نتائج الآيات (بحثٌ في النصّ) */}
                  {ayahHits.length > 0 && (
                    <>
                      <p className="mt-2 px-2 text-[11px] font-extrabold uppercase tracking-wide opacity-60">
                        نتائجٌ في الآيات
                      </p>
                      {ayahHits.map((h) => (
                        <button
                          key={`${h.surah}:${h.ayah}`}
                          onClick={() => jumpTo(h.page)}
                          className="press mb-1 flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-right transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <span className="text-[11px] font-extrabold text-[#8a6508] dark:text-amber-300">
                            سورة {displayName(surahNameByNumber(h.surah))} · الآية {toArabicDigits(h.ayah)} · صفحة{' '}
                            {toArabicDigits(h.page)}
                          </span>
                          <span className="font-quran line-clamp-2 text-sm leading-snug">{h.text}</span>
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-center gap-1.5 border-t border-black/5 py-1.5 text-[11px] font-bold opacity-60 dark:border-white/10">
              <BookOpen className="h-3.5 w-3.5" />
              المصحف المدنيّ · {toArabicDigits(TOTAL_PAGES)} صفحة
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** فتح «المصحف الكامل» من أي مكان. */
export const openReader = (page?: number) => navigate(readerHash(page));
