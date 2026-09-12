// src/data/mushafData.ts
// Complete 604-page Madinah Mushaf (Hafs) — structured local dataset loader.
// Data: public/data/mushaf-pages.json (built from the Uthmani edition; every
// ayah carries its page / juz / surah so the 604 printed pages are exact).

export interface MushafAyah {
  s: number; // surah number
  n: number; // ayah number within the surah
  t: string; // full Uthmani text (words preserved, never split)
}

export interface MushafPage {
  p: number; // printed page number (1..604)
  j: number; // juz number
  s: number; // surah number of the first ayah on the page
  sn: string; // surah display name (with diacritics)
  a: MushafAyah[];
}

export interface MushafData {
  surahs: { n: number; name: string }[];
  pages: MushafPage[];
}

export const TOTAL_PAGES = 604;
export const LINES_PER_PAGE = 15;
export const BASMALAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

// Arabic-Indic digits (e.g. 353 → ٣٥٣)
export const toArabicDigits = (n: number | string): string =>
  String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

// Strip Arabic diacritics + the "سُورَةُ" prefix to compare surah names.
// يوحّد أيضاً صور الهمزة والتاء المربوطة والألف المقصورة، لأنّ أسماء المنهج
// القصيرة تُكتب «الانفال/البقره/التوبه» بينما أسماء المصحف «الأَنفَال/البَقَرَة/التَّوْبَة».
export function normalizeName(s: string): string {
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u08F0-\u08FF]/g, '')
    .replace(/^\s*سورة\s*/u, '')
    .replace(/[\u0622\u0623\u0625\u0627\u0671]/g, 'ا') // آ أ إ ا ٱ → ا
    .replace(/\u0629/g, 'ه') // ة → ه
    .replace(/[\u0649\u064A]/g, 'ي') // ى ي → ي
    .replace(/[\u0624\u0626]/g, '\u0621') // ؤ ئ → ء
    .replace(/\s+/g, ' ')
    .trim();
}

let cache: MushafData | null = null;
let inflight: Promise<MushafData> | null = null;
// (surah, ayah) → page number
let ayahIndex: Map<string, number> | null = null;

function buildIndex(d: MushafData) {
  ayahIndex = new Map();
  for (const page of d.pages) {
    for (const ay of page.a) {
      ayahIndex.set(`${ay.s}:${ay.n}`, page.p);
    }
  }
}

// ---- إزالة البسملة المكرّرة من نصّ الآية الأولى ---------------------------
// مجموعة البيانات تحمل البسملة مُلحَقة داخل نصّ الآية الأولى (١١٠ سور). وفي
// المصحف المطبوع البسملة سطرٌ مستقلٌّ أعلى السورة فقط — ليست من الآية (إلا في
// الفاتحة حيث هي الآية الأولى نفسها). فنحذفها هنا حتى لا تُرسم مرتين.
const BASMALAH_WORD_COUNT = 4; // بِسْمِ · ٱللَّهِ · ٱلرَّحْمَٰنِ · ٱلرَّحِيمِ

function stripBasmalah(t: string): string {
  const s = t.trimStart();
  // ١) مطابقة النصّ المعروف
  if (s.startsWith(BASMALAH)) {
    const rest = s.slice(BASMALAH.length).trimStart();
    if (rest) return rest;
  }
  // ٢) احتياط: أربع كلمات تبدأ بـ«بسم» (اختلاف تشكيل محتمل)
  const words = s.split(/\s+/);
  if (words.length > BASMALAH_WORD_COUNT) {
    const bare = words[0].replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
    if (bare === 'بسم') {
      const rest = words.slice(BASMALAH_WORD_COUNT).join(' ').trim();
      if (rest) return rest;
    }
  }
  return t; // لا نُفرغ نصّاً أبداً
}

export async function loadMushaf(): Promise<MushafData> {
  if (cache) return cache;
  if (inflight) return inflight;
  // BASE_URL يضبطه Vite حسب base: '/' محلياً، و«/<اسم-المستودع>/» على GitHub Pages.
  inflight = fetch(`${import.meta.env.BASE_URL}data/mushaf-pages.json`)
    .then((r) => {
      if (!r.ok) throw new Error('فشل تحميل بيانات المصحف');
      return r.json() as Promise<MushafData>;
    })
    .then((d) => {
      for (const page of d.pages) {
        for (const ay of page.a) {
          // strip any BOM from the texts
          if (ay.t.charCodeAt(0) === 0xfeff) ay.t = ay.t.slice(1);
          // البسملة سطرٌ مستقلّ: تُنزع من نصّ الآية الأولى (عدا الفاتحة)
          if (ay.n === 1 && ay.s !== 1) ay.t = stripBasmalah(ay.t);
        }
      }
      cache = d;
      buildIndex(d);
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Cached dataset (may be null before the first load resolves). */
export function mushafData(): MushafData | null {
  return cache;
}

/** Page number of a specific (surah, ayah), or null if not indexed yet. */
export function pageOfAyah(surah: number, ayah: number): number | null {
  return ayahIndex?.get(`${surah}:${ayah}`) ?? null;
}

/** أول صفحة تُطبع فيها السورة (احتياطٌ لا يُسقطنا على صفحة ١ أبداً). */
export function firstPageOfSurah(surah: number): number | null {
  const d = cache;
  if (!d) return null;
  for (const page of d.pages) for (const ay of page.a) if (ay.s === surah) return page.p;
  return null;
}

/** آخر صفحة تُطبع فيها السورة. */
export function lastPageOfSurah(surah: number): number | null {
  const d = cache;
  if (!d) return null;
  for (let i = d.pages.length - 1; i >= 0; i--) {
    for (const ay of d.pages[i].a) if (ay.s === surah) return d.pages[i].p;
  }
  return null;
}

/** Resolve a surah number from an Arabic name (with or without diacritics). */
export function surahNumberByName(name: string): number | null {
  const d = cache;
  if (!d) return null;
  const target = normalizeName(name);
  const hit = d.surahs.find((s) => normalizeName(s.name) === target);
  return hit ? hit.n : null;
}

/** True if the page opens a surah (its first ayah is verse 1 of that surah). */
export function pageOpensSurah(page: MushafPage): boolean {
  return page.a.length > 0 && page.a[0].n === 1;
}

/** أرقام السور التي تبدأ داخل الصفحة (بعد السورة الأولى). */
export function surahsStartingInside(page: MushafPage): number[] {
  const first = page.a[0]?.s;
  const out: number[] = [];
  for (const ay of page.a) {
    if (ay.n === 1 && ay.s !== first && !out.includes(ay.s)) out.push(ay.s);
  }
  return out;
}

/** اسم السورة (بالتشكيل الكامل، مثل «سُورَةُ الفَلَقِ»). */
export function surahNameByNumber(n: number): string | null {
  const hit = cache?.surahs.find((s) => s.n === n);
  return hit ? hit.name : null;
}

/** Whether to render a basmalah band (surah opens here; not Al-Fatiha/Tawbah). */
export function pageShowsBasmalah(page: MushafPage): boolean {
  if (!pageOpensSurah(page)) return false;
  const s = page.a[0].s;
  return s !== 1 && s !== 9;
}
