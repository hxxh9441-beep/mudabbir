// src/components/MushafView.tsx
// Authentic Madinah Mushaf viewer — full-screen, 604 pages, 15 lines per page.
//
// Design (matches the genuine Madinah Mushaf / "Image 2"):
//  • The PAGE IS THE SCREEN — no floating beige card, no outer frame.
//  • Dark mode → pure OLED black (#000) with off-white Uthmani text (#EAE5D9).
//  • Light mode → parchment (#FAF7EE) with deep-brown ink (#1E140A).
//  • Exactly 15 lines; each line is a flex row (justify-between) of whole words
//    — never letter-split, never text-align:justify (no awkward web gaps).
//  • Header inside the page: surah name (right) · juz (left).
//  • Ornate page-number ornament at the bottom centre (٣٥٣).
//  • Buffer engine: startPage-1 … endPage+1 with scope dimming (opacity-30).
//  • Word tap cycles 1=yellow (تردد) 2=red (خطأ) 3=clear.
//  • Sticky bottom dock: counters + [مسح] [رجوع] [تم].
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AYAH_MEDALLION_ASPECT,
  AYAH_MEDALLION_CENTRE,
  AYAH_MEDALLION_PATH,
  AYAH_MEDALLION_VIEWBOX,
} from './authenticOrnaments';
import { db, getDaySession, isoDay, saveRecitationPart } from '../db';
import type { Student } from '../db/schema';
import {
  loadMushaf,
  pageOfAyah,
  surahNumberByName,
  surahNameByNumber,
  firstPageOfSurah,
  lastPageOfSurah,
  toArabicDigits,
  BASMALAH,
  LINES_PER_PAGE,
  TOTAL_PAGES,
} from '../data/mushafData';
import type { MushafData, MushafPage, MushafAyah } from '../data/mushafData';
import { sessionGet, sessionSet, sessionRemove } from '../utils/session';
import { dayStatuses, nextPositionAfter } from '../utils/dailyPlan';

type WordState = Record<string, number>; // `${s}:${n}:${i}` -> 0|1|2

/** عنصرٌ في سطر: كلمة (بنصّها) أو ميدالية آية. */
export interface LineItem {
  kind: 'word' | 'marker';
  ayah: MushafAyah;
  text?: string;
  wordKey?: string;
}

interface Props {
  ringId: number;
  studentId: number;
  onBack: () => void;
  onApproved: () => void;
}

interface SavedRecite {
  mode?: 'hifz' | 'murajaah';
  surah?: string;
  startVerse?: number;
  endVerse?: number;
}

/** هدفٌ صريح يكتبه زر «مصحف مرئي» من وضعه الحالي (حفظ/مراجعة). */
interface MushafTarget {
  mode?: 'hifz' | 'murajaah';
  /** رقم السورة — المصدر الأوثق لصفحة المهمّة */
  surahNumber?: number;
  surah?: string;
  startVerse?: number;
  endVerse?: number;
  /** المقدار بوحدة المادة (أسطر للحفظ / أوجه للمراجعة) */
  amount?: number;
}

const DEFAULT_ASSIGNMENT = { surah: 'النور', startVerse: 28, endVerse: 31 };
const DEFAULT_SURAH_NUMBER = 24; // النور — احتياطٌ أخير إن فشل كل شيء

// Width proxy for balancing lines: base letters + a fraction of the marks.
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
export const massOf = (t: string) => {
  const marks = (t.match(MARKS) ?? []).length;
  const base = t.replace(MARKS, '').length || 1;
  return base + marks * 0.4;
};

// ---- Combining-mark safety (fixes the ◌ U+25CC dotted-circle bug) ----------
// A token made ONLY of combining marks / waqf signs has no base letter; rendered
// alone the browser paints a dotted-circle placeholder. We also strip any stray
// U+25CC the data may carry. Such marks are merged into the neighbouring word so
// word + diacritics + waqf sign always live in ONE string/one element.
const ORPHAN_MARK =
  /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640\u200B-\u200F]+$/;
const DOTTED_CIRCLE = /\u25CC/g;

export function wordsOf(text: string): string[] {
  const raw = text.replace(DOTTED_CIRCLE, '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const tok of raw) {
    const orphan = ORPHAN_MARK.test(tok);
    if (orphan && out.length) out[out.length - 1] += tok; // attach to previous word
    else out.push(tok);
  }
  // a leading orphan (before any base word) folds forward into the first word
  if (out.length > 1 && ORPHAN_MARK.test(out[0])) {
    out[1] = out[0] + out[1];
    out.shift();
  }
  return out;
}

// Split a word into [letters, trailing pause sign]. ONLY the true mushaf pause
// block (U+06D6–U+06DC) is pulled out — those are the ۖ ۗ ۘ ۙ ۚ ۛ ۜ annotations,
// which the hafs font paints low and heavy so they clash with the letter bodies.
// Everything else (including U+06DF/U+06E3/U+06EB) stays bound to its base
// letter: isolating a plain combining mark paints the .notdef dotted circle.
const WAQF_TAIL = /^([\s\S]*?)([\u06D6-\u06DC]+)$/;
export function splitWaqf(text: string): [string, string] {
  const m = text.match(WAQF_TAIL);
  if (!m || !m[1]) return [text, ''];
  return [m[1], m[2]];
}
const HAS_WAQF = /[\u06D6-\u06DC]/;

// Reference-size width of one ayah medallion inside a line: the badge is drawn
// at 1.48× the line font, ≈0.805 as wide as tall, plus its side margins —
// expressed in the same 100px reference units the word widths use.
const MEDALLION_REF = 145;

/**
 * عائلة خطّ النصّ القرآنيّ — **مصدرٌ واحد** للقياس والرسم معاً.
 * كان القياس هنا باسم عائلةٍ قديمة (`"Uthmanic Hafs", "QuranMarks"`) لمّا غُيّر
 * الخطّ: فكانت القياسات تُؤخذ من خطّ النظام لا من خطّ المصحف ⇒ اختلّ توزيع
 * الكلمات على الأسطر فبدت النهايات متفاوتة (٦٦٪–٩٦٪ من العرض). يُقرأ الآن من
 * ثابتٍ واحد، ويجب أن يبقى مطابقاً لعائلة `.font-quran` في `index.css`.
 */
export const QURAN_FONT_STACK =
  '"Quran Text", "Amiri Quran", "Scheherazade New", "Traditional Arabic", serif';

// Measure every word's REAL rendered width with the Quran font (at a reference
// size — widths scale linearly, so balancing is size-independent). This gives
// evenly-filled lines, exactly like the printed page (no stretched gaps).
export function measureWordWidths(page: MushafPage): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('no 2d ctx');
    ctx.font = `100px ${QURAN_FONT_STACK}`;
    for (const ay of page.a) {
      wordsOf(ay.t).forEach((w, i) => {
        const width = ctx.measureText(w).width;
        map.set(`${ay.s}:${ay.n}:${i}`, width > 1 ? width : massOf(w) * 10);
      });
    }
  } catch {
    /* fall back to the mass proxy */
  }
  return map;
}

// ---- أسطر الصفحة ------------------------------------------------------------
// الصفحة = مقاطع (سورة تبدأ فيها أو استكمال سورة)، وكل سورة تبدأ في الصفحة
// تأخذ سطرين مستقلّين بعرض الصفحة قبل آياتها: سطرَ الإطار (اسم السورة)، ثم سطرَ
// البسملة تحته مباشرةً. لا يُدمج فاصلٌ ولا بسملة في سطر آيات أبداً. والسطران
// يُحسبان داخل رصيد الصفحة (١٥ سطراً) فيبقى عدد أسطر الصفحة ١٥ كما في المطبوع.
export type PageRow =
  | { kind: 'band'; surah: number }
  | { kind: 'basmalah'; surah: number }
  | {
      kind: 'text';
      tokens: LineItem[];
      /** آخر سطرٍ في السورة ⇒ يُوسَّط ولا يُمدَّد (كما في المطبوع) */
      centered?: boolean;
    };

interface PageItem {
  toks: LineItem[];
  w: number;
}

/** عناصر المقطع: كلمة + ما يتبعها (نقاط الوقف وميدالية الآية) — لا يُكسر شيء. */
function itemsOf(ayahs: MushafAyah[], widths?: Map<string, number>): PageItem[] {
  const items: PageItem[] = [];
  for (const ay of ayahs) {
    wordsOf(ay.t).forEach((w, i) => {
      const tk: LineItem = { kind: 'word', ayah: ay, text: w, wordKey: `${ay.s}:${ay.n}:${i}` };
      items.push({ toks: [tk], w: widths?.get(tk.wordKey!) ?? massOf(w) * 10 });
    });
    const mk: LineItem = { kind: 'marker', ayah: ay };
    if (items.length === 0) items.push({ toks: [mk], w: MEDALLION_REF });
    else {
      items[items.length - 1].toks.push(mk);
      items[items.length - 1].w += MEDALLION_REF;
    }
  }
  return items;
}

// Balance a segment across EXACTLY L lines with a dynamic-programming partition
// that minimises the squared deviation of each line's real width from the mean.
// Even line widths are what let the font grow large AND keep the natural
// Madinah spacing (no stretched whitespace from justify-between).
// `commonTarget` يجعل كل مقاطع الصفحة تُوازَن على العرض نفسه (تناسق بصري).
function partitionItems(items: PageItem[], L: number, commonTarget?: number): LineItem[][] {
  const n = items.length;
  if (n === 0) return [];
  if (n <= L) return items.map((it) => it.toks);

  const ps = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + items[i].w;
  const target = commonTarget && commonTarget > 0 ? commonTarget : ps[n] / L;

  // dp layers: cost of splitting the first i items into k lines
  let prev = new Array<number>(n + 1).fill(Infinity);
  for (let i = 1; i <= n; i++) prev[i] = (ps[i] - target) ** 2;
  const splits: number[][] = [new Array<number>(n + 1).fill(0)];
  for (let k = 2; k <= L; k++) {
    const cur = new Array<number>(n + 1).fill(Infinity);
    const sp = new Array<number>(n + 1).fill(0);
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        const cost = prev[j] + (ps[i] - ps[j] - target) ** 2;
        if (cost < cur[i]) {
          cur[i] = cost;
          sp[i] = j;
        }
      }
    }
    prev = cur;
    splits.push(sp);
  }

  const bounds: number[] = [];
  let i = n;
  for (let k = L; k >= 1; k--) {
    bounds.unshift(i);
    i = splits[k - 1][i];
  }
  bounds.unshift(0);

  const lines: LineItem[][] = [];
  for (let k = 0; k < L; k++) {
    const out: LineItem[] = [];
    for (let idx = bounds[k]; idx < bounds[k + 1]; idx++) out.push(...items[idx].toks);
    lines.push(out);
  }
  return lines;
}

/** أسطر الصفحة كاملة: إطارات + بسملات + آيات، مجموعها ١٥ سطراً. */
export function buildRows(page: MushafPage, widths?: Map<string, number>): PageRow[] {
  // ١) المقاطع: كل آية رقمها ١ تبدأ مقطعاً جديداً (سورة جديدة في الصفحة)
  const segs: MushafAyah[][] = [];
  for (const ay of page.a) {
    if (ay.n === 1 || segs.length === 0) segs.push([ay]);
    else segs[segs.length - 1].push(ay);
  }
  const parts = segs.map((ayahs) => {
    const starts = ayahs[0].n === 1;
    const surah = ayahs[0].s;
    const items = itemsOf(ayahs, widths);
    return {
      surah,
      band: starts,
      basmalah: starts && surah !== 1 && surah !== 9,
      items,
      w: items.reduce((s, it) => s + it.w, 0) || 1,
    };
  });

  // ٢) رصيد أسطر الآيات = ١٥ − (أسطر الإطارات والبسملات)
  const extras = parts.reduce((s, p) => s + (p.band ? 1 : 0) + (p.basmalah ? 1 : 0), 0);
  const budget = Math.max(parts.length, LINES_PER_PAGE - extras);

  // ٣) توزيع الرصيد على المقاطع بنسبة ثقلها الحقيقي (تقريبٌ لأقرب عدد صحيح)
  //    ثم ضبط المجموع ليكون = budget بالضبط. هكذا تخرج أسطر كل السور بعرضٍ
  //    متقاربٍ واحد (لا سورةً تتنفّس بسطورٍ نصف فارغة وأخرى مضغوطة)، ولا يأخذ
  //    مقطعٌ أسطراً أكثر من عدد عناصره.
  const total = parts.reduce((s, p) => s + p.w, 0) || 1;
  const alloc = parts.map((p) => Math.max(1, Math.round((budget * p.w) / total)));
  const capOf = (i: number) => Math.max(1, parts[i].items.length);
  const ratioOf = (i: number) => parts[i].w / alloc[i];
  let sum = alloc.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum > budget && guard++ < 4000) {
    // نُنقص من المقطع الأكثر ترفاً (أكبر وزن لكل سطر) ما دام فوق سطرٍ واحد
    let pick = -1;
    let best = -Infinity;
    parts.forEach((_, i) => {
      if (alloc[i] <= 1) return;
      const r = ratioOf(i);
      if (r > best) {
        best = r;
        pick = i;
      }
    });
    if (pick < 0) break;
    alloc[pick] -= 1;
    sum -= 1;
  }
  guard = 0;
  while (sum < budget && guard++ < 4000) {
    // نزيد للمقطع الأكثف (أصغر وزن لكل سطر) ما دام تحت سقف عناصره
    let pick = -1;
    let best = Infinity;
    parts.forEach((_, i) => {
      if (alloc[i] >= capOf(i)) return;
      const r = ratioOf(i);
      if (r < best) {
        best = r;
        pick = i;
      }
    });
    if (pick < 0) break;
    alloc[pick] += 1;
    sum += 1;
  }

  // ٤) السطور: إطارٌ ⇒ بسملةٌ ⇒ آيات السورة. وآخرُ سطرٍ في كل سورة يُوسَّط
  //    (لا يُمدَّد) لأنّه لا يبلغ عرض الصفحة عادةً — كما في المصحف المطبوع.
  const commonTarget = total / budget;
  const rows: PageRow[] = [];
  parts.forEach((p, i) => {
    if (p.band) rows.push({ kind: 'band', surah: p.surah });
    if (p.basmalah) rows.push({ kind: 'basmalah', surah: p.surah });
    const segLines = partitionItems(p.items, alloc[i], commonTarget);
    segLines.forEach((ln, li) => {
      rows.push({ kind: 'text', tokens: ln, centered: li === segLines.length - 1 });
    });
  });
  // الصفحة ١٥ سطراً دائماً — سطرٌ فارغ في الحالات النادرة التي لا تكفيها الكلمات
  while (rows.length < LINES_PER_PAGE) rows.push({ kind: 'text', tokens: [], centered: true });
  return rows;
}

/** العرض المرجعي لسطر نصّي (بوحدات 100px) — يُقاس به امتلاء السطر. */
export function rowRefWidth(row: PageRow, widths?: Map<string, number>): number {
  if (row.kind !== 'text') return 0;
  let sum = 0;
  let k = 0;
  for (const t of row.tokens) {
    if (t.kind === 'marker') {
      // the medallion occupies real width on the line
      sum += MEDALLION_REF;
      continue;
    }
    sum += widths?.get(t.wordKey!) ?? massOf(t.text ?? '') * 10;
    // a trailing pause sign is lifted out of the word as a superscript
    // annotation: budget its own (small) advance so the line still fits
    if (HAS_WAQF.test(t.text ?? '')) sum += 62;
    k++;
  }
  return sum + k * 8;
}

// نسبة امتلاء السطر التي تُعدّ «سطراً ممتلئاً» فيُوزَّع على الطرفين. السطر الذي
// يقصُر عن ذلك قصْراً واضحاً (سطرٌ أخير أو سورةٌ قصيرة) يُوسَّط بلا أيّ تمديد —
// فلا تتفتّح بين كلماته فراغاتٌ. والعتبة مُنتقاة من توزيع الامتلاء الحقيقي في
// المصحف كلّه (الوسيط 91٪ والعُشر الأدنى 84٪) فلا يُوسَّط إلا القصير فعلاً.
export const FULL_LINE_RATIO = 0.8;

// ---- ornamental primitives (all inline SVG: no bidi mirroring, no tofu) ----

export function Diamond({ size = 6, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className} aria-hidden="true">
      <path d="M5 0 L10 5 L5 10 L0 5 Z" fill="currentColor" />
    </svg>
  );
}

// Solid filled page-turn triangles (no wireframe strokes, no bidi mirroring:
// these are SVG paths, so RTL never flips them).
export function Triangle({ dir, size = 20 }: { dir: 'left' | 'right'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={dir === 'left' ? 'M18 3 L6 12 L18 21 Z' : 'M6 3 L18 12 L6 21 Z'} fill="currentColor" />
    </svg>
  );
}

// AUTHENTIC ayah medallion — the real King Fahd Madinah Mushaf vector, extracted
// from the community tracing (see authenticOrnaments.ts). Nothing here is
// hand-drawn: the outline is the printed artwork and the numeral is simply
// overlaid in the medallion's hollow centre, exactly as on the page.
export function AyahBadge({ n, h }: { n: number; h: number }) {
  const w = h * AYAH_MEDALLION_ASPECT;
  const cx = AYAH_MEDALLION_CENTRE.x;
  const cy = AYAH_MEDALLION_CENTRE.y;
  // Hollow measured inside the authentic tracing (source viewBox units):
  // 11.56 wide × 8.22 tall, with its true centre sitting 0.36 right of the
  // path's own centre — so the numeral is placed on the hollow, not the path.
  const HOLLOW_W = 11.56;
  const DIGIT_EM = 0.585; // advance of one Arabic-Indic digit in this Naskh face
  const digits = String(n).length;
  // Size the numeral to sit QUIETLY inside the hollow — the printed-mushaf
  // balance: the digits occupy ~71% of the hollow's width, leaving ~15% of even
  // breathing room on each side. The ornament itself is untouched; only the
  // numeral scales, and it stays centred on the measured hollow centre.
  const fs = Math.min(7.3, (HOLLOW_W * 0.71) / (digits * DIGIT_EM));
  return (
    <svg
      width={Math.round(w * 100) / 100}
      height={h}
      viewBox={AYAH_MEDALLION_VIEWBOX}
      className="block overflow-visible"
      aria-hidden="true"
    >
      <path d={AYAH_MEDALLION_PATH} fill="currentColor" fillRule="nonzero" />
      <text
        x={cx - 0.36}
        y={cy + 0.11 + fs * 0.26}
        textAnchor="middle"
        fontSize={fs}
        className="mushaf-badge-num"
      >
        {toArabicDigits(n)}
      </text>
    </svg>
  );
}

/**
 * الزخرفة وحدها (بلا رقم) — الميدالية الأصيلة نفسها بلا رقمٍ داخلها، تُستعمل
 * طرفاً زخرفياً لإطار اسم السورة (كما في المطبوع المدنيّ).
 */
export function MedallionOrnament({ h = 18, className = '' }: { h?: number; className?: string }) {
  const w = h * AYAH_MEDALLION_ASPECT;
  return (
    <svg
      width={Math.round(w * 100) / 100}
      height={h}
      viewBox={AYAH_MEDALLION_VIEWBOX}
      className={`block overflow-visible ${className}`}
      aria-hidden="true"
    >
      <path d={AYAH_MEDALLION_PATH} fill="currentColor" fillRule="nonzero" />
    </svg>
  );
}

// Page number — the traditional minimalist treatment: the number alone, in the
// SAME digit face as the ayah medallions, wrapped in thin parentheses. Nothing
// else: the printed KFQC page carries a bare numeral too (the ornamental
// cartouche people associate with the Madinah mushaf is the surah-name band).
// `dir="ltr"` keeps the pair from being bidi-mirrored in the RTL page.
export function PageNumber({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span dir="ltr" className={`mushaf-digit whitespace-nowrap ${className}`}>
      (<span className="px-[0.18em]">{toArabicDigits(n)}</span>)
    </span>
  );
}


// ---- إطار اسم السورة: لم يبقَ إطار ------------------------------------------
// لا صندوق ولا مستطيل: اسم السورة بين هلالين، يشقّ يمينه ويساره خطٌّ رقيق
// ذهبيّ ينتهي بمعيّنين — زخرفةٌ تقليديّة هادئة بلا تحصينٍ مستطيل صارم.
//
// المقاس ثابتٌ في المصحف كلّه (لا يتبع حجم خطّ الآيات): ١٧px نصف عريض،
// والبسملة ١٦px — فيبقى فاصل السورة واحداً على كل صفحة وعلى كل شاشة.
export const SURAH_TITLE_SIZE = '17px'; // ≈1.1rem
export const BASMALAH_SIZE = '16px'; // 1rem

function bandLabel(name: string): string {
  return `( ${name} )`;
}

export function SurahBand({ name }: { name: string }) {
  return (
    <div className="flex w-full items-center justify-center gap-2 px-1 sm:gap-3">
      <span className="mushaf-orn-soft h-px flex-1 bg-current opacity-40" />
      <Diamond size={5} className="mushaf-orn shrink-0 opacity-75" />
      <span
        className="font-mushaf whitespace-nowrap font-semibold leading-snug"
        style={{ fontSize: SURAH_TITLE_SIZE }}
      >
        {bandLabel(name)}
      </span>
      <Diamond size={5} className="mushaf-orn shrink-0 opacity-75" />
      <span className="mushaf-orn-soft h-px flex-1 bg-current opacity-40" />
    </div>
  );
}

// بسملة السورة — سطرٌ مستقلّ مُوسّط بعرض الصفحة، أسفل الإطار مباشرةً، بحجمٍ
// ثابت (١٦px) لا يتغيّر من صفحةٍ إلى أخرى.
export function BasmalahLine() {
  return (
    <span
      className="font-quran whitespace-nowrap font-semibold leading-snug"
      style={{ fontSize: BASMALAH_SIZE }}
    >
      {BASMALAH}
    </span>
  );
}

// ---- إطار السورة داخل السطر: أُلغي ------------------------------------------
// الفواصل والبسملات صارت أسطراً مستقلة بعرض الصفحة (انظر buildRows) — فلا
// يُدمج فاصلٌ ولا بسملة في سطر آيات أبداً، كما في المصحف المطبوع.

export default function MushafView({ ringId: _ringId, studentId, onBack, onApproved }: Props) {
  const [data, setData] = useState<MushafData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [fontPx, setFontPx] = useState(20);
  const [rowPx, setRowPx] = useState(34);
  // the page column hugs the text: it is sized from the line font so the widest
  // line lands exactly on the page edge and justification adds no dead space
  const [colMax, setColMax] = useState<number | null>(null);
  // bumped whenever the reading area actually changes size, so the fit effect
  // re-measures instead of keeping a value taken before the layout settled
  const [fitTick, setFitTick] = useState(0);

  const storageKey = `quran:${studentId}`;
  const [states, setStates] = useState<WordState>(() => sessionGet<WordState>(`${storageKey}:states`, {}));

  const bodyRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  /** مقدار السحب اللحظيّ (px) — نُطلقه في حركة استقرار الصفحة الجديدة */
  const dragX = useRef(0);
  /** اتّجاه آخر تنقّل (next/prev) — تُشغَّل الحركة مرّةً واحدة عند تغيّر الصفحة */
  const turnDir = useRef<'next' | 'prev' | null>(null);

  /** حركة استقرار الصفحة عند كل تغيير (زرٌّ أو سحب) — مرّة واحدة لكل تغيير. */
  useEffect(() => {
    const dir = turnDir.current;
    turnDir.current = null;
    const el = bodyRef.current;
    if (!el) return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!dir || reduce) {
      dragX.current = 0;
      el.style.transition = 'none';
      el.style.transform = 'translateX(0)';
      el.style.opacity = '1';
      return;
    }
    const dragged = dragX.current;
    dragX.current = 0;
    if (Math.abs(dragged) < 1) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${dir === 'next' ? -18 : 18}px)`;
      el.style.opacity = '0.55';
      void el.offsetWidth;
    }
    el.style.transition = 'transform 220ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease';
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx]);

  // أولوية المصدر: هدفٌ صريح من زر «مصحف مرئي» (يتبع الوضع الحالي حفظ/مراجعة)
  // ثم مسودة التسميع، ثم الافتراضي. هذا ما يجعل الزر سياقيّاً.
  const target = sessionGet<MushafTarget | null>(`mushaf:${studentId}`, null);
  const draft = sessionGet<SavedRecite | null>(`recite:${studentId}`, null);
  const assignment = {
    // الوضع الذي جاء منه الزر (حفظ/مراجعة) — يُسجَّل عليه الجزء في السجل
    mode: (target?.mode ?? draft?.mode ?? 'hifz') as 'hifz' | 'murajaah',
    // رقم السورة القادم من الورقة: أوثق من الاسم (لا يتأثّر باختلاف رسم الهمزات)
    surahNumber: target?.surahNumber ?? null,
    surah: target?.surah ?? draft?.surah ?? DEFAULT_ASSIGNMENT.surah,
    startVerse: target?.startVerse ?? draft?.startVerse ?? DEFAULT_ASSIGNMENT.startVerse,
    endVerse: target?.endVerse ?? draft?.endVerse ?? DEFAULT_ASSIGNMENT.endVerse,
  };
  const assignmentLabel = `${assignment.surah} ${assignment.startVerse} - ${assignment.endVerse}`;

  useEffect(() => {
    let alive = true;
    loadMushaf()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setLoadErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  const range = useMemo(() => {


  if (!data) return null;
    // رقم السورة: من الورقة مباشرةً، وإلا من الاسم بمطابقة متسامحة (همزات/تاء).
    const sn =
      assignment.surahNumber ?? surahNumberByName(assignment.surah) ?? DEFAULT_SURAH_NUMBER;
    // صفحة آية البداية بالضبط (الأنفال ٧١ ⇒ ١٨٦)، وإن تعذّر — لآيةٍ خارج حدود
    // السورة — نرجع لأول صفحةٍ للك سورة، ولا نسقط على صفحة ١ أبداً.
    const first = firstPageOfSurah(sn);
    const sPage = pageOfAyah(sn, assignment.startVerse) ?? first ?? 1;
    const ePage = pageOfAyah(sn, assignment.endVerse) ?? lastPageOfSurah(sn) ?? sPage;
    return {
      sn,
      sPage,
      ePage,
      start: Math.max(1, sPage - 1),
      end: Math.min(TOTAL_PAGES, Math.max(sPage, ePage) + 1),
    };
  }, [data, assignment.surahNumber, assignment.surah, assignment.startVerse, assignment.endVerse]);

  useEffect(() => {
    if (range) setPageIdx(range.sPage - range.start);
  }, [range]);

  const page = data && range ? data.pages[range.start + pageIdx - 1] : null;
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const done = () => alive && setFontsReady(true);
    const fonts = document.fonts;
    if (!fonts) {
      done();
      return;
    }
    // لا يكفي `fonts.ready`: مع `font-display: swap` قد يتمّ تبديل الوجه **بعد**
    // قياس عرض الكلمات، فتُبنى الأسطر على مقاسات الخطّ البديل فيبدو التوزيع
    // متفاوتاً. فنُجبر تحميل الوجه بمحارف القياس (حروفاً وعلامات وقف) ثم نُقيس.
    const probe =
      '\u0670\u0671\u06D6\u06DA\u06DE\u06DF\u06E0\u06E2\u06E3\u06E5\u06E6\u06E9\u06EB\u06ED\u064E\u0651';
    Promise.all([
      fonts.load('20px "Quran Text"', probe),
      fonts.load('20px "Quran Text"', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'),
    ])
      .catch(() => {})
      .finally(done);
    return () => {
      alive = false;
    };
  }, []);

  // ---- ONE geometry for the WHOLE buffer range ----------------------------
  // Each page in the range gets its own 15 rows (bands + basmalahs + verses),
  // but the font size is shared across all of them, so the active page and the
  // dimmed buffer pages keep an identical box model.
  const pageLayouts = useMemo(() => {
    if (!data || !range)
      return [] as { p: number; rows: PageRow[]; refs: number[]; maxRef: number }[];
    const out: { p: number; rows: PageRow[]; refs: number[]; maxRef: number }[] = [];
    for (let p = range.start; p <= range.end; p++) {
      const pg = data.pages[p - 1];
      if (!pg) continue;
      const widths = fontsReady ? measureWordWidths(pg) : undefined;
      const rows = buildRows(pg, widths);
      // عرض كل سطر بالوحدات المرجعية: نسبةُ امتلاء السطر تُقارَن بأوسع سطر
      // فيُعرَف أيّ سطرٍ يستحقّ التمديد (الممتلئ) وأيّها يُوسَّط (القصير).
      const refs = rows.map((row) => rowRefWidth(row, widths));
      const maxRef = refs.reduce((m, v) => Math.max(m, v), 0);
      out.push({ p, rows, refs, maxRef });
    }
    return out;
  }, [data, range, fontsReady]);

  const rows = pageLayouts[pageIdx]?.rows ?? [];
  const rowRefs = pageLayouts[pageIdx]?.refs ?? [];
  const maxRef = pageLayouts[pageIdx]?.maxRef ?? 0;
  const bufferLen = pageLayouts.length || 1;

  // ---- fit: one font size + one leading for every page in the range -------
  // ‏الهدف: أن تملأ الصفحة شاشة الجيب (9:16) بلا ضغطٍ ولا فراغ — يُقاس العرض
  // الحقيقي لأوسع سطر (بلا فواصل السور) فيُضبط الخطّ ليملأ العرض، ويُوزَّع
  // ارتفاع القراءة على ١٥ سطراً بالتساوي فيملأ الارتفاع.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !rows.length) return;
    const raf = requestAnimationFrame(() => {
      const vw = window.innerWidth;
      // The TRUE width of the widest rendered TEXT row: the sum of the intrinsic
      // widths of its children (whole words + ayah medallions). Measuring the
      // real DOM beats any estimate — the medallions, the word padding and the
      // trailing pause signs are all already in it.
      let widestRow = 0;
      const els = Array.from(body.querySelectorAll<HTMLElement>('.mushaf-line'));
      for (const r of els) {
        let w = 0;
        for (const el of Array.from(r.children)) w += (el as HTMLElement).getBoundingClientRect().width;
        widestRow = Math.max(widestRow, w);
      }
      if (!widestRow) return;

      const PAD = 24; // px-3 حشو الصفحة + هوامش السطر + نفَسٌ صغير
      const availW = Math.max(120, vw - PAD);
      // ١٥ سطراً تملأ ارتفاع القراءة بالتساوي (الفواصل والبسملات داخلها)
      const evenRow = Math.max(12, Math.floor(body.clientHeight / LINES_PER_PAGE));
      // Ceilings: HEIGHT (each row must still breathe ≈1.62×) and WIDTH (the
      // longest row lands exactly on the page edge). Word widths scale linearly
      // with the font, so the width ceiling follows from the measured row.
      const byHeight = Math.floor(evenRow / 1.62);
      const byWidth = Math.max(9, Math.floor((availW * fontPx) / widestRow));
      const next = Math.max(9, Math.min(byHeight, byWidth, 60));
      setFontPx(next);
      // السطر = حصة الارتفاع نفسها بالضبط ⇒ الكتابة تملأ شاشة الجيب رأسياً
      // بلا فراغ ميّت، والتباعد يبقى دائماً ≥ 1.62× (لأنّ الخطّ محصورٌ بها).
      setRowPx(evenRow);
      // Hug the page: the column is exactly the longest row plus its padding, so
      // justify-between has no slack left to stretch into word gaps.
      const capped = Math.min(Math.round((widestRow * next) / fontPx) + PAD, vw - 4);
      setColMax((prev) => (prev !== null && Math.abs(prev - capped) < 3 ? prev : capped));
    });
    return () => cancelAnimationFrame(raf);
  }, [rows, data, colMax, pageIdx, fitTick, fontPx]);

  // Re-measure whenever the reading area REALLY changes size: covers the
  // first-paint race (the effect could otherwise latch a height taken before
  // the header/footer settled), phone rotation, and mobile browser chrome
  // appearing or hiding.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFitTick((t) => t + 1));
    ro.observe(body);
    return () => ro.disconnect();
  }, [data]);

  useEffect(() => {
    sessionSet(`${storageKey}:states`, states);
  }, [states, storageKey]);

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
  if (!data || !range || !page) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black">
        <p className="animate-pulse text-[#EAE5D9]/70">جارٍ تحميل المصحف…</p>
      </div>
    );
  }

  const inScope = (ay: MushafAyah, pageNum: number): boolean => {
    if (ay.s !== range.sn) return false;
    if (pageNum < range.sPage || pageNum > range.ePage) return false;
    if (pageNum === range.sPage && pageNum === range.ePage)
      return ay.n >= assignment.startVerse && ay.n <= assignment.endVerse;
    if (pageNum === range.sPage) return ay.n >= assignment.startVerse;
    if (pageNum === range.ePage) return ay.n <= assignment.endVerse;
    return true;
  };

  const nextState = (s: number) => (s + 1) % 3;

  const tapWord = (e: React.MouseEvent, ay: MushafAyah, idx: number, scope: boolean) => {
    e.preventDefault();
    if (!scope) return;
    const k = `${ay.s}:${ay.n}:${idx}`;
    setStates((p) => ({ ...p, [k]: nextState(p[k] ?? 0) }));
  };

  const tapMarker = (e: React.MouseEvent, ay: MushafAyah, scope: boolean) => {
    e.preventDefault();
    if (!scope) return;
    const keys = wordsOf(ay.t).map((_, i) => `${ay.s}:${ay.n}:${i}`);
    const allAt = (s: number) => keys.every((k) => (states[k] ?? 0) === s);
    const target = allAt(0) ? 1 : allAt(1) ? 2 : 0;
    setStates((p) => {
      const nx = { ...p };
      keys.forEach((k) => (nx[k] = target));
      return nx;
    });
  };

  let yellow = 0;
  let red = 0;
  for (const pg of data.pages.slice(range.start - 1, range.end)) {
    for (const ay of pg.a) {
      if (!inScope(ay, pg.p)) continue;
      if (ay.t) {
        wordsOf(ay.t).forEach((_, i) => {
          const st = states[`${ay.s}:${ay.n}:${i}`] ?? 0;
          if (st === 1) yellow++;
          if (st === 2) red++;
        });
      }
    }
  }

  const goPrev = () => {
    turnDir.current = 'prev';
    setPageIdx((i) => Math.max(0, i - 1));
  };
  const goNext = () => {
    turnDir.current = 'next';
    setPageIdx((i) => Math.min(bufferLen - 1, i + 1));
  };

  /**
   * **إيماءة قلب الصفحة** — نفس اتفاقيّة المصحف الورقيّ (RTL) المطبَّقة في
   * القارئ المستقلّ، فلا يختلف الإحساس بين الواجهتين:
   *   • يميناً (dx موجب) ⇒ الصفحة **التالية**.
   *   • يساراً (dx سالب) ⇒ الصفحة **السابقة**.
   * ويتّبع النصّ الإصبع أثناء السحب ثمّ يستقرّ بحركة ٢٢٠ms (transform/opacity فقط).
   */
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
    dragX.current = 0;
    setPageShift(0, 1, false);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.touches[0].clientX - touchX.current;
    dragX.current = dx;
    const damp = Math.min(1, Math.abs(dx) / 220);
    setPageShift(dx * 0.35, 1 - damp * 0.35, false);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 45) {
      dragX.current = 0;
      setPageShift(0, 1, true);
      return;
    }
    dragX.current = dx;
    if (dx > 0) goNext();
    else goPrev();
  };

  const approve = async () => {
    const span = Math.max(1, assignment.endVerse - assignment.startVerse + 1);
    const score = Math.max(0, 20 - red);
    const day = isoDay();
    try {
      // صفٌّ واحد لليوم: نُحدّث المادة الحالية فيه فقط (فتُبنى عليها حالة
      // «اكتمل الجزءان» في ورقة التسميع وعلى البطاقة).
      const already = dayStatuses(await getDaySession(studentId, day))[assignment.mode] !== 'none';
      await saveRecitationPart(studentId, day, assignment.mode, {
        amount: target?.amount ?? span,
        score,
        note: `${assignmentLabel} (${assignment.mode === 'hifz' ? 'حفظ' : 'مراجعة'})`,
      });
      // تقديم الموضع الجاري مرّة واحدة عند أول تسجيل لهذه المادة اليوم
      if (!already) {
        const st = (await db.student.get(studentId)) as Student | undefined;
        const next = st ? nextPositionAfter(st, assignment.mode) : null;
        if (st?.id !== undefined && next) {
          await db.student.update(
            st.id,
            (assignment.mode === 'hifz'
              ? { currentSurah: next.surah, currentAyah: next.ayah }
              : { murajaahCurrentSurah: next.surah, murajaahCurrentAyah: next.ayah }) as never,
          );
        }
      }
    } catch (e) {
      console.error('فشل حفظ الجلسة', e);
    }
    sessionRemove(storageKey);
    sessionRemove(`recite:${studentId}`);
    onApproved();
  };

  // word highlight classes — subtle badge behind the word, text never changes
  const stateClass = (st: number, scope: boolean) => {
    if (!scope) return 'cursor-default';
    if (st === 1)
      return 'cursor-pointer rounded bg-amber-400/30 border-b-2 border-amber-500/70 dark:bg-amber-300/25 dark:border-amber-400/60';
    if (st === 2)
      return 'cursor-pointer rounded bg-rose-500/30 border-b-2 border-rose-600/80 dark:bg-rose-500/25 dark:border-rose-400/60';
    return 'cursor-pointer rounded border-b-2 border-transparent hover:bg-amber-400/15';
  };

  return (
    <div
      className="fixed inset-x-0 top-0 z-[70] flex h-screen flex-col overflow-hidden bg-[#FAF7EE] text-[#1E140A] supports-[height:100dvh]:h-[100dvh] dark:bg-black dark:text-[#EAE5D9]"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* ===== the page IS the screen (no card, no chrome) =====
          The column is set from the reading area at runtime: wide enough that
          the page's longest line lands exactly on the padding edge (so a phone
          fills the screen with nothing but px-3/px-4 of air), and no wider —
          extra width would only be handed back as stretched word gaps. */}
      <div
        style={{ maxWidth: colMax ?? 544 }}
        className="mx-auto flex min-h-0 w-full flex-1 flex-col px-3 pt-2 pb-1 sm:px-4"
      >
        {/* page header (inside the page): surah (right) · juz (left) — nothing
            else, so the page reads like a printed mushaf, not an app */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-0.5">
          <span className="flex items-center gap-1.5">
            <Diamond size={5} className="mushaf-orn shrink-0 opacity-80" />
            <span className="font-mushaf text-base font-bold sm:text-xl">{page.sn}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs font-semibold opacity-80 sm:text-sm">
              الجزء {toArabicDigits(page.j)}
            </span>
            <Diamond size={5} className="mushaf-orn shrink-0 opacity-80" />
          </span>
        </div>
        {/* hairline ornament under the header (traditional rule) */}
        <div className="mushaf-orn-soft mx-2 mb-0.5 flex shrink-0 items-center gap-1.5 opacity-45">
          <span className="h-px flex-1 bg-current" />
          <Diamond size={4} className="shrink-0" />
          <span className="h-px flex-1 bg-current" />
        </div>

        {/* ===== الصفحة: إطارات السور + البسملات + الآيات — ١٥ سطراً =====
            فاصل السورة سطرٌ كامل مُوسَّط، والبسملة سطرٌ كامل تحته، ثم الآيات.
            لا يُدمج فاصلٌ ولا بسملة في سطر آيات أبداً. */}
        <div ref={bodyRef} dir="rtl" className="relative flex min-h-0 flex-1 flex-col justify-center overflow-visible px-1">
          {rows.map((row, li) => {
            if (row.kind === 'band') {
              const nm = surahNameByNumber(row.surah);
              return (
                <div
                  key={`band-${row.surah}`}
                  className="mushaf-row flex w-full shrink-0 items-center justify-center"
                  style={{ height: `${rowPx}px`, fontSize: `${fontPx}px`, lineHeight: 1 }}
                >
                  {nm ? <SurahBand name={nm} /> : null}
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
            // سطرٌ قصيرٌ بطبيعته (أو آخر سطرٍ في السورة) ⇒ يُوسَّط بلا أيّ تمديد؛
            // فالمدُّ يُوزَّع على الطرفين للسطر الممتلئ وحده.
            const ref = rowRefs[li] ?? 0;
            const centered = !!row.centered || (maxRef > 0 && ref < maxRef * FULL_LINE_RATIO);
            return (
              <div
                key={`t-${li}`}
                data-fill={maxRef > 0 ? Math.round((ref / maxRef) * 100) : 0}
                className={`mushaf-line flex w-full shrink-0 items-center whitespace-nowrap ${
                  centered ? 'justify-center' : 'justify-between'
                }`}
                style={{ fontSize: `${fontPx}px`, height: `${rowPx}px`, lineHeight: 1 }}
              >
                {/* render the line's tokens IN ORDER — a word, then its diacritics,
                    then (if that word ends its ayah) the ayah medallion. Never
                    group all words first: the badge marks the END of its own
                    ayah, so it must sit exactly after that ayah's last word. */}
                {row.tokens.map((t) => {
                  if (t.kind === 'word') {
                    const scope = inScope(t.ayah, page.p);
                    const st = scope ? states[t.wordKey!] ?? 0 : 0;
                    const idx = Number(t.wordKey!.split(':')[2]);
                    return (
                      <button
                        key={t.wordKey}
                        type="button"
                        data-word="1"
                        onClick={(e) => tapWord(e, t.ayah, idx, scope)}
                        style={{ opacity: scope ? 1 : 0.3 }}
                        className={`font-quran inline-block shrink-0 whitespace-nowrap px-[0.04em] tracking-normal transition-colors duration-150 ${stateClass(
                          st,
                          scope,
                        )}`}
                      >
                        {/* whole word + its diacritics + waqf sign: ONE string */}
                        {(() => {
                          const [body, waqf] = splitWaqf(t.text ?? '');
                          return (
                            <>
                              {body}
                              {waqf ? <span className="mushaf-waqf">{waqf}</span> : null}
                            </>
                          );
                        })()}
                      </button>
                    );
                  }
                  const scope = inScope(t.ayah, page.p);
                  // ≈1.48× the line font: a touch smaller than the printed
                  // medallion so it never crowds the lines above and below, while
                  // the numeral inside stays the dominant element.
                  const h = Math.max(16, Math.round(fontPx * 1.48));
                  return (
                    <button
                      key={`m-${t.ayah.s}:${t.ayah.n}`}
                      type="button"
                      onClick={(e) => tapMarker(e, t.ayah, scope)}
                      title={`تحديد الآية ${toArabicDigits(t.ayah.n)} كلها`}
                      style={{ opacity: scope ? 0.95 : 0.3 }}
                      className="press mushaf-orn mx-[0.12em] shrink-0 cursor-pointer leading-none"
                    >
                      {/* floral ayah rosette (Madinah style) — square SVG, never clipped */}
                      <span className="pointer-events-none block">
                        <AyahBadge n={t.ayah.n} h={h} />
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* page number — just the number in thin parentheses, nothing else */}
        <div className="flex shrink-0 items-center justify-center pt-0.5">
          <PageNumber n={page.p} className="text-[1.05rem] opacity-80" />
        </div>
      </div>

      {/* ===== sticky bottom dock =====
          Right: [رجوع] [مسح] · Center: ‹ › · Left: counters + [تم]
          (the page number lives once, in the cartouche above — no duplication) */}
      <footer className="relative w-full shrink-0 border-t border-white/10 bg-black/90 px-2 py-1.5 backdrop-blur-xl">
        <div className="flex w-full items-center justify-between gap-1.5">
          {/* right — exit & reset */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onBack}
              className="press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/10 px-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20"
            >
              رجوع
            </button>
            <button
              onClick={() => setStates({})}
              aria-label="مسح التحديد"
              className="press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/10 px-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20"
            >
              مسح
            </button>
          </div>

          {/* center — pager, ABSOLUTELY centered so unequal flex ends cannot
              push it off-centre. RTL reading order: the RIGHT triangle (pointing
              right) steps BACK to the previous page, the LEFT triangle (pointing
              left) advances to the next page. Solid filled SVG — never mirrored. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center">
            <button
              onClick={goPrev}
              disabled={pageIdx <= 0}
              aria-label="الصفحة السابقة"
              className="press pointer-events-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-amber-200/80 transition-colors hover:bg-white/10 disabled:opacity-25"
            >
              <Triangle dir="right" />
            </button>
            <button
              onClick={goNext}
              disabled={pageIdx >= bufferLen - 1}
              aria-label="الصفحة التالية"
              className="press pointer-events-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-amber-200/80 transition-colors hover:bg-white/10 disabled:opacity-25"
            >
              <Triangle dir="left" />
            </button>
          </div>

          {/* left — counters + approve */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="inline-flex min-h-[36px] items-center gap-2 rounded-full bg-white/10 px-2.5">
              <span className="inline-flex items-center gap-1 text-sm font-extrabold text-rose-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />
                {red}
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-extrabold text-amber-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-300" />
                {yellow}
              </span>
            </span>
            <button
              onClick={approve}
              className="press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-green-600 px-3 text-sm font-extrabold text-white shadow-lg shadow-green-700/40 transition-colors hover:bg-green-500"
            >
              تم
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
