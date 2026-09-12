// src/components/StudentForm.tsx
// نموذج الطالب الموحّد — يُستخدم للإضافة والتعديل معاً (نفس الميزات ونفس التخطيط
// ونفس الخيارات حرفياً). الفرق الوحيد:
//   • إضافة : يبدأ بقيم افتراضية معقولة (ابتدائي/رابع · ٥ أسطر من الناس ١ · ٣ أوجه)
//   • تعديل : يُحمّل قيم الطالب الحالية، ويُضاف أسفل النموذج زر الحذف (في المُعدِّل)
// الأقسام:
//   ١) الحفظ   : المقدار اليومي + نقطة البداية والاتجاه + المهمّة القادمة
//   ٢) المراجعة: المقدار + (⚡ ضبط تلقائي حسب المحفوظ) + البداية والاتجاه
//   ٣) الحالة  : ⏸ إيقاف الحفظ مؤقتاً بعدّاد أيام
import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Minus, Pause, Plus, Search, Sparkles } from 'lucide-react';
import { createStudent, isoDay, persistStudentEdit } from '../db';
import type { Student, ProgressDirection } from '../db/schema';
import {
  DIRECTION_LABEL,
  DIRECTION_START,
  ayahCountOf,
  computeAssignment,
  describeAssignment,
  describeMemorized,
  firstMemorizedPosition,
  furtherPosition,
  loadCurriculum,
  maxAyahInMemorized,
  memorizedFrom,
  searchSurahs,
  surahShort,
} from '../utils/progression';
import type { Position, SurahInfo, WalkBounds } from '../utils/progression';

// ---- المرحلة → صفوفها: every stage reveals only its own grades ----------
export const STAGES: { key: string; grades: string[] }[] = [
  { key: 'ابتدائي', grades: ['رابع', 'خامس', 'سادس'] },
  { key: 'متوسط', grades: ['أول', 'ثاني', 'ثالث'] },
  { key: 'ثانوي', grades: ['أول', 'ثاني', 'ثالث'] },
];
const ALL_GRADES = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس'];
const PRIMARY_ONLY = ['رابع', 'خامس', 'سادس'];

const gradesOf = (stage: string) => STAGES.find((s) => s.key === stage)?.grades ?? [];

// Older records only carry the composed `level` («ثاني»). Recover a sensible
// (stage, grade) pair from it so the 2-step selector opens on the right values.
function inferStageGrade(stage?: string, grade?: string, level?: string) {
  if (stage && grade && gradesOf(stage).includes(grade)) return { stage, grade };
  const lv = (level ?? '').trim();
  let st = stage ?? '';
  let gr = grade ?? '';
  if (!st) st = STAGES.find((s) => lv.includes(s.key))?.key ?? '';
  if (!gr) gr = ALL_GRADES.find((g) => lv.includes(g)) ?? '';
  if (!st) st = PRIMARY_ONLY.includes(gr) ? 'ابتدائي' : gr ? 'متوسط' : '';
  if (st && gr && !gradesOf(st).includes(gr)) gr = gradesOf(st)[0] ?? gr;
  return { stage: st, grade: gr };
}

// ---- numeric helpers ---------------------------------------------------
const round05 = (v: number) => Math.max(0, Math.round((Number.isFinite(v) ? v : 0) * 10) / 10);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const arDigits = (s: string) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

const LABEL_CLS = 'mb-2 block text-sm font-bold text-[#5A4636] dark:text-amber-100/80';
const chipCls = (on: boolean) =>
  `press rounded-full px-3.5 py-2 text-sm font-bold ring-1 ring-inset transition ${
    on
      ? 'bg-[#B8860B] text-white ring-amber-400/50 shadow-md shadow-amber-800/30'
      : 'bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/70 ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20'
  }`;

/** القيم الافتراضية لطالبٍ جديد: ابتدائي/رابع · ٥ أسطر من الناس ١ · ٣ أوجه. */
export const NEW_STUDENT_DEFAULTS = {
  stage: 'ابتدائي',
  grade: 'رابع',
  hifzTarget: 5,
  murajaahTarget: 3,
  direction: 'nas-to-baqarah' as ProgressDirection,
  surah: 114, // الناس
  ayah: 1,
  pauseDays: 7,
};

/** ترويسة قسم منطقي */
function SectionTitle({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-amber-900/10 dark:border-amber-500/15 pb-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#B8860B] text-[11px] font-extrabold text-white">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">{title}</p>
        {sub && <p className="text-[11px] text-[#8a7261] dark:text-amber-100/40">{sub}</p>}
      </div>
    </div>
  );
}

/** مفتاح تبديل (switch) */
function Switch({
  on,
  onChange,
  label,
  hint,
  tone = 'gold',
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  tone?: 'gold' | 'amber';
}) {
  const accent = tone === 'amber' ? 'bg-amber-500' : 'bg-[#B8860B]';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`press flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-right ring-1 ring-inset transition ${
        on ? 'bg-black/[0.07] dark:bg-amber-100/15 ring-[#B8860B]/50 dark:ring-amber-400/40' : 'bg-black/[0.03] dark:bg-amber-100/5 ring-amber-900/10 dark:ring-amber-500/15 hover:bg-black/[0.08] dark:hover:bg-amber-100/10'
      }`}
    >
      <span className="min-w-0">
        <span className={`block text-xs font-extrabold ${on ? 'text-[#B8860B] dark:text-amber-200' : 'text-[#5A4636] dark:text-amber-100/70'}`}>
          {label}
        </span>
        {hint && <span className="block text-[10px] text-[#8a7261] dark:text-amber-100/40">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? accent : 'bg-black/[0.10] dark:bg-amber-100/20'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            on ? 'right-0.5' : 'right-[22px]'
          }`}
        />
      </span>
    </button>
  );
}

// Lines / pages target: presets + stepper, both driving the same value.
function TargetField({
  label,
  unit,
  value,
  onChange,
  presets,
  id,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  presets: number[];
  id: string;
}) {
  return (
    <div>
      <label className={LABEL_CLS} htmlFor={id}>
        {label}
      </label>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = Math.abs(value - p) < 0.001;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-pressed={on}
              className={chipCls(on)}
            >
              {arDigits(fmt(p))} {unit}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(round05(value - 0.5))}
          aria-label={`تقليل ${label}`}
          className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/80 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 transition hover:bg-black/10 dark:hover:bg-amber-100/20"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          id={id}
          type="number"
          step={0.5}
          min={0}
          inputMode="decimal"
          dir="ltr"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(round05(Number(e.target.value)))}
          className="h-11 min-w-0 flex-1 rounded-xl border border-black/10 dark:border-amber-500/20 bg-black/[0.05] dark:bg-amber-100/10 px-3 text-center text-lg font-extrabold text-[#2D1F17] dark:text-[#F5EBE1] outline-none transition focus:border-amber-400/60 focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="button"
          onClick={() => onChange(round05(value + 0.5))}
          aria-label={`زيادة ${label}`}
          className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/80 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 transition hover:bg-black/10 dark:hover:bg-amber-100/20"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="shrink-0 text-xs font-bold text-[#6B5B4A] dark:text-amber-100/50">{unit}</span>
      </div>
    </div>
  );
}

// بطاقة نقطة البداية: السورة + رقم الآية + الاتجاه + المهمّة القادمة.
function ProgressionCard({
  title,
  surah,
  ayah,
  direction,
  currentSurah,
  currentAyah,
  amount,
  unit,
  onSurah,
  onAyah,
  onDirection,
  filter,
  maxAyahFor,
  bounds,
  note,
  warn,
}: {
  title: string;
  surah: number;
  ayah: number;
  direction: ProgressDirection;
  currentSurah?: number;
  currentAyah?: number;
  amount: number;
  unit: 'lines' | 'pages';
  onSurah: (n: number) => void;
  onAyah: (n: number) => void;
  onDirection: (d: ProgressDirection) => void;
  filter?: (s: SurahInfo) => boolean;
  maxAyahFor?: (surah: number) => number;
  /** حدود السير (نطاق المحفوظ) — تُطبَّق على معاينة «المهمّة القادمة» */
  bounds?: WalkBounds;
  note?: string;
  warn?: string;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const hardMax = ayahCountOf(surah) || 1;
  const allowed = maxAyahFor ? maxAyahFor(surah) : hardMax;
  const maxAyah = Math.max(1, Math.min(hardMax, allowed || hardMax));
  const clampedAyah = Math.min(Math.max(1, ayah), maxAyah);
  const results = picking ? searchSurahs(query, 8, filter) : [];

  const fromSurah = currentSurah ?? surah;
  const fromAyah = currentAyah ?? ayah;
  const task = computeAssignment({ surah: fromSurah, ayah: fromAyah }, direction, amount, unit, bounds);
  const hasCursor = fromSurah !== surah || fromAyah !== ayah;

  return (
    <div className="rounded-2xl border border-amber-900/10 dark:border-amber-500/15 bg-black/[0.03] dark:bg-amber-100/[0.04] p-3.5">
      <p className="mb-3 flex items-center gap-2 text-xs font-extrabold text-[#5A4636] dark:text-amber-100/70">
        <Compass className="h-3.5 w-3.5 shrink-0 text-[#B8860B]" />
        {title}
      </p>

      <button
        type="button"
        onClick={() => {
          setPicking((v) => !v);
          setQuery('');
        }}
        aria-expanded={picking}
        className="press flex w-full items-center justify-between gap-2 rounded-xl bg-black/[0.05] dark:bg-amber-100/10 px-3 py-2.5 text-sm font-bold text-[#2D1F17] dark:text-[#F5EBE1] ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20"
      >
        <span className="text-[#6B5B4A] dark:text-amber-100/60">السورة</span>
        <span className="flex items-center gap-1.5 font-extrabold text-[#B8860B] dark:text-amber-200">
          {surahShort(surah)}
          <Search className="h-3.5 w-3.5 opacity-60" />
        </span>
      </button>

      {picking && (
        <div className="mt-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filter ? 'ابحث في المحفوظ…' : 'ابحث عن سورة…'}
            className="w-full rounded-xl border border-black/10 dark:border-amber-500/20 bg-black/[0.05] dark:bg-amber-100/10 px-3 py-2 text-sm text-[#2D1F17] dark:text-[#F5EBE1] placeholder-[#8a7261] dark:placeholder-amber-200/40 outline-none focus:border-amber-400/60"
          />
          <div className="mt-1.5 max-h-44 overflow-y-auto rounded-xl ring-1 ring-inset ring-amber-900/10 dark:ring-amber-500/15">
            {results.length === 0 && (
              <p className="px-3 py-2 text-xs text-[#8a7261] dark:text-amber-100/40">لا نتائج داخل النطاق</p>
            )}
            {results.map((s) => (
              <button
                key={s.n}
                type="button"
                onClick={() => {
                  onSurah(s.n);
                  onAyah(1);
                  setPicking(false);
                  setQuery('');
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-sm ${
                  s.n === surah
                    ? 'bg-[#B8860B]/25 font-extrabold text-white'
                    : 'text-[#5A4636] dark:text-amber-100/80 hover:bg-black/[0.08] dark:hover:bg-amber-100/10'
                }`}
              >
                <span>{s.key}</span>
                <span className="text-[11px] text-[#8a7261] dark:text-amber-100/35">
                  {s.ayahs} آية · ص{s.page}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-xs font-bold text-[#6B5B4A] dark:text-amber-100/60">رقم الآية</span>
        <button
          type="button"
          onClick={() => onAyah(Math.max(1, clampedAyah - 1))}
          aria-label="إنقاص رقم الآية"
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/80 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          min={1}
          max={maxAyah}
          dir="ltr"
          value={clampedAyah}
          onChange={(e) => onAyah(Math.min(maxAyah, Math.max(1, Number(e.target.value) || 1)))}
          className="h-9 min-w-0 flex-1 rounded-lg border border-black/10 dark:border-amber-500/20 bg-black/[0.05] dark:bg-amber-100/10 px-2 text-center text-sm font-extrabold text-[#2D1F17] dark:text-[#F5EBE1] outline-none focus:border-amber-400/60"
        />
        <button
          type="button"
          onClick={() => onAyah(Math.min(maxAyah, clampedAyah + 1))}
          aria-label="زيادة رقم الآية"
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/80 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <span className="shrink-0 text-[11px] font-bold text-[#8a7261] dark:text-amber-100/35">/{maxAyah}</span>
      </div>

      <p className="mb-1.5 mt-3 text-xs font-bold text-[#6B5B4A] dark:text-amber-100/60">
        اتجاه السير <span className="font-normal text-[#8a7261] dark:text-amber-100/40">(اختيارٌ حرّ)</span>
      </p>
      <div className="space-y-1.5">
        {(Object.keys(DIRECTION_LABEL) as ProgressDirection[]).map((d) => {
          const on = direction === d;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => onDirection(d)}
              className={`press w-full rounded-xl px-3 py-2 text-xs font-extrabold ring-1 ring-inset transition ${
                on
                  ? 'bg-[#B8860B] text-white ring-amber-400/50 shadow-md shadow-amber-800/30'
                  : 'bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/70 ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20'
              }`}
            >
              {DIRECTION_LABEL[d]}
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl bg-[#B8860B]/10 px-3 py-2 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20">
        <p className="text-[11px] font-bold text-[#6B5B4A] dark:text-amber-100/55">المهمّة القادمة</p>
        <p className="mt-0.5 text-sm font-extrabold text-[#B8860B] dark:text-amber-200">
          {task ? describeAssignment(task) : '—'}
        </p>
        {task && (
          <p className="mt-1 text-[11px] leading-relaxed text-[#6B5B4A] dark:text-amber-100/45">
            {task.ayahs} آية ≈ {task.pages} وجه · الصفحات {task.pageFrom}–{task.pageTo}
            {task.nextStart && (
              <>
                {' '}
                · ثم: {surahShort(task.nextStart.surah)} {task.nextStart.ayah}
              </>
            )}
          </p>
        )}
        {hasCursor && (
          <p className="mt-1 text-[11px] font-bold text-amber-300/70">
            الموضع الحالي: {surahShort(fromSurah)} {fromAyah}
          </p>
        )}
      </div>

      {note && <p className="mt-2 text-[11px] font-bold text-amber-300/70">{note}</p>}
      {warn && <p className="mt-2 text-[11px] font-bold text-rose-300/80">⚠ {warn}</p>}
    </div>
  );
}

export interface StudentFormProps {
  /** null ⇒ إضافة طالب جديد (بالقيم الافتراضية) */
  student: Student | null;
  /** الحلقة التي يُضاف إليها الطالب الجديد */
  ringId?: number;
  /** بادئة معرّفات الحقول: 'add' أو 'edit' */
  idPrefix: string;
  /** نصّ زر الحفظ */
  submitLabel: string;
  onClose: () => void;
  onSaved?: (student: Student) => void;
}

export default function StudentForm({
  student,
  ringId,
  idPrefix,
  submitLabel,
  onClose,
  onSaved,
}: StudentFormProps) {
  const isNew = student === null;
  const D = NEW_STUDENT_DEFAULTS;

  const [ready, setReady] = useState(false);
  const [name, setName] = useState(student?.name ?? '');
  const [{ stage, grade }, setStageGrade] = useState(() => {
    if (student) return inferStageGrade(student.stage, student.grade, student.level);
    return { stage: D.stage, grade: D.grade };
  });
  const [hifzTarget, setHifzTarget] = useState(
    round05(student?.hifzTarget ?? D.hifzTarget),
  );
  const [murajaahTarget, setMurajaahTarget] = useState(
    round05(student?.murajaahTarget ?? D.murajaahTarget),
  );

  // ---- محرّك التدرّج ----
  const [hifzDir, setHifzDir] = useState<ProgressDirection>(
    student?.hifzDirection ?? D.direction,
  );
  const [hifzSurah, setHifzSurah] = useState(
    student?.hifzStartSurah ?? DIRECTION_START[student?.hifzDirection ?? D.direction].surah,
  );
  const [hifzAyah, setHifzAyah] = useState(
    student?.hifzStartAyah ?? DIRECTION_START[student?.hifzDirection ?? D.direction].ayah,
  );
  const [murDir, setMurDir] = useState<ProgressDirection>(
    student?.murajaahDirection ?? D.direction,
  );
  const [murSurah, setMurSurah] = useState(
    student?.murajaahStartSurah ?? DIRECTION_START[student?.murajaahDirection ?? D.direction].surah,
  );
  const [murAyah, setMurAyah] = useState(
    student?.murajaahStartAyah ?? DIRECTION_START[student?.murajaahDirection ?? D.direction].ayah,
  );
  // الموضع الجاري للطالب: للقراءة فقط في النموذج (يُقرّره التسميع لا التحرير)
  const [curSurah] = useState<number | undefined>(student?.currentSurah);
  const [curAyah] = useState<number | undefined>(student?.currentAyah);
  const [murCurSurah] = useState<number | undefined>(student?.murajaahCurrentSurah);
  const [murCurAyah] = useState<number | undefined>(student?.murajaahCurrentAyah);
  // ⚡ ضبط المراجعة حسب المحفوظ
  const [autoSync, setAutoSync] = useState(student?.autoSyncRevision ?? true);
  // ⏸ إيقاف الحفظ مؤقتاً
  const [paused, setPaused] = useState(student?.hifzPaused ?? false);
  const [pauseDays, setPauseDays] = useState(
    Math.max(1, student?.hifzPauseDays ?? D.pauseDays),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCurriculum()
      .then(() => alive && setReady(true))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, []);

  // ── نطاق المحفوظ المُتقَن: المراجعة لا تتجاوز ما حُفظ فعلاً ──
  // «الدرس الجاري» (السورة التي يقف فيها الطالب) خارج النطاق حتى يُكمَل — فلا
  // تختلط المراجعة بالحفظ الجديد. مثال: طالبٌ عند الكهف ⇒ النطاق «مريم ← الناس».
  const memorized = useMemo(() => {
    if (!ready) return null;
    const start: Position = { surah: hifzSurah, ayah: hifzAyah };
    const cur: Position | null =
      curSurah !== undefined && curAyah !== undefined ? { surah: curSurah, ayah: curAyah } : null;
    return memorizedFrom(furtherPosition(start, cur, hifzDir), hifzDir);
  }, [ready, hifzSurah, hifzAyah, hifzDir, curSurah, curAyah]);

  /** هل هناك محفوظٌ فعلاً؟ (الطالب الجديد: لا شيء بعد) */
  const hasMemorized = !!memorized && !memorized.empty;

  const murAllowed = (surah: number) => (memorized ? maxAyahInMemorized(surah, memorized) : 0);
  const murOutOfRange = useMemo(
    () => (autoSync || !memorized ? false : !memorized.empty && murAllowed(murSurah) === 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoSync, memorized, murSurah],
  );

  /** هل اختار المعلّم بنفسه اتجاه/بداية المراجعة؟ فلا يزاحمه الضبط التلقائي.
   *  وما هو محفوظٌ في سجلّ الطالب = اختيارُ المعلّم ⇒ يُحترم في كل فتحة. */
  const murDirTouched = useRef(!isNew && student?.murajaahDirection !== undefined);
  const murStartTouched = useRef(!isNew && student?.murajaahStartSurah !== undefined);

  // ⚡ الضبط التلقائي: يتبع اتجاه الحفظ وبداية أول المحفوظ **افتراضاً** فقط —
  // فإذا كان للمعلّم اختيارٌ محفوظ داخل النطاق تركناه وشأنه (المراجعة من الأحدث
  // نزولاً أو من الأقدم صعوداً: القرار للمعلّم)، وإن خرج اختيارُه عن النطاق
  // (أو لم يوجد) أعدناه إلى أول المحفوظ. ولطالبٍ جديد تبدأ المراجعة من بداية الحفظ.
  useEffect(() => {
    if (!autoSync || !memorized) return;
    if (memorized.empty) {
      if (!murStartTouched.current) {
        setMurDir(hifzDir);
        setMurSurah(hifzSurah);
        setMurAyah(hifzAyah);
      }
      return;
    }
    if (!murDirTouched.current) setMurDir(hifzDir);
    // داخل النطاق واختاره المعلّم ⇒ لا نمسّه (وإلا ضاع اختياره عند كل فتحة)
    if (murStartTouched.current && maxAyahInMemorized(murSurah, memorized) > 0) return;
    const pos = firstMemorizedPosition(memorized, hifzDir);
    if (!pos) return;
    setMurSurah(pos.surah);
    setMurAyah(pos.ayah);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoSync,
    hifzDir,
    hifzSurah,
    hifzAyah,
    memorized?.minSurah,
    memorized?.maxSurah,
    memorized?.boundaryAyahs,
    memorized?.empty,
    murSurah,
  ]);

  const clean = name.trim();

  /** حقول الطالب كما تُحفظ في Dexie — مسارٌ واحد للإضافة والتعديل. */
  const buildFields = () => {
    const hifzStartChanged =
      isNew ||
      student.hifzStartSurah !== hifzSurah ||
      student.hifzStartAyah !== hifzAyah ||
      student.hifzDirection !== hifzDir;
    const murStartChanged =
      isNew ||
      student.murajaahStartSurah !== murSurah ||
      student.murajaahStartAyah !== murAyah ||
      student.murajaahDirection !== murDir;

    return {
      name: clean,
      level: [grade, stage].filter(Boolean).join(' '),
      stage,
      grade,
      hifzTarget: round05(hifzTarget),
      murajaahTarget: round05(murajaahTarget),
      hifzStartSurah: hifzSurah,
      hifzStartAyah: hifzAyah,
      hifzDirection: hifzDir,
      murajaahStartSurah: murSurah,
      murajaahStartAyah: murAyah,
      murajaahDirection: murDir,
      currentSurah: hifzStartChanged || student?.currentSurah === undefined ? hifzSurah : student.currentSurah,
      currentAyah: hifzStartChanged || student?.currentAyah === undefined ? hifzAyah : student.currentAyah,
      murajaahCurrentSurah:
        murStartChanged || student?.murajaahCurrentSurah === undefined
          ? murSurah
          : student.murajaahCurrentSurah,
      murajaahCurrentAyah:
        murStartChanged || student?.murajaahCurrentAyah === undefined
          ? murAyah
          : student.murajaahCurrentAyah,
      autoSyncRevision: autoSync,
      // ⏸: عند الإيقاف نبدأ العدّ من اليوم
      hifzPaused: paused,
      hifzPauseDays: paused ? Math.max(1, Math.round(pauseDays)) : 0,
      hifzPauseStartedOn: paused
        ? student?.hifzPaused && student.hifzPauseStartedOn
          ? student.hifzPauseStartedOn
          : isoDay()
        : undefined,
    };
  };

  const handleSave = async () => {
    if (!clean || busy) return;
    setBusy(true);
    try {
      const fields = buildFields();
      if (isNew) {
        const created = await createStudent(ringId ?? 0, fields);
        if (created) onSaved?.({ ...(created as Student) });
      } else {
        await persistStudentEdit(student.id, fields);
        onSaved?.(student);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
      className="space-y-6"
    >
      {/* ── الهوية ── */}
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-bold text-[#5A4636] dark:text-amber-100/80" htmlFor={`${idPrefix}-name`}>
            اسم الطالب
          </label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="الاسم الكامل"
            className="w-full rounded-xl border border-black/10 dark:border-amber-500/20 bg-black/[0.05] dark:bg-amber-100/10 px-4 py-3 text-[#2D1F17] dark:text-[#F5EBE1] placeholder-[#8a7261] dark:placeholder-amber-200/40 outline-none transition focus:border-amber-400/60 focus:bg-black/[0.07] dark:bg-amber-100/15 focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-[#5A4636] dark:text-amber-100/80">المرحلة</label>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={stage === s.key}
                onClick={() => {
                  setStageGrade((p) => ({
                    stage: s.key,
                    grade: s.grades.includes(p.grade) ? p.grade : s.grades[0],
                  }));
                }}
                className={chipCls(stage === s.key)}
              >
                {s.key}
              </button>
            ))}
          </div>
        </div>

        {stage && (
          <div>
            <label className="mb-2 block text-sm font-bold text-[#5A4636] dark:text-amber-100/80">
              الصف <span className="font-normal text-[#6B5B4A] dark:text-amber-100/50">({stage})</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {gradesOf(stage).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={grade === g}
                  onClick={() => setStageGrade((p) => ({ ...p, grade: g }))}
                  className={chipCls(grade === g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ القسم ١: الحفظ ══ */}
      <div className="space-y-4 rounded-2xl border border-black/10 dark:border-amber-500/20 bg-black/15 p-3.5">
        <SectionTitle n="١" title="الحفظ" sub="المقدار اليومي ونقطة البداية والاتجاه" />
        <TargetField
          id={`${idPrefix}-hifz`}
          label="مقدار الحفظ اليومي"
          unit="أسطر"
          value={hifzTarget}
          onChange={setHifzTarget}
          presets={[3, 5, 7.5]}
        />
        {ready ? (
          <ProgressionCard
            title="نقطة البداية واتجاه السير"
            surah={hifzSurah}
            ayah={hifzAyah}
            direction={hifzDir}
            currentSurah={curSurah}
            currentAyah={curAyah}
            amount={hifzTarget}
            unit="lines"
            onSurah={(n) => {
              setHifzSurah(n);
              setHifzAyah(1);
            }}
            onAyah={setHifzAyah}
            onDirection={(d) => {
              setHifzDir(d);
              setHifzSurah(DIRECTION_START[d].surah);
              setHifzAyah(DIRECTION_START[d].ayah);
            }}
            note={memorized ? `المحفوظ حتى الآن: ${describeMemorized(memorized)}` : undefined}
          />
        ) : (
          <p className="py-2 text-center text-xs font-bold text-[#8a7261] dark:text-amber-100/40">
            جارٍ تحميل فهرس المنهج…
          </p>
        )}
      </div>

      {/* ══ القسم ٢: المراجعة ══ */}
      <div className="space-y-4 rounded-2xl border border-black/10 dark:border-amber-500/20 bg-black/15 p-3.5">
        <SectionTitle n="٢" title="المراجعة" sub="المقدار ونطاق المراجعة الذكي" />

        <Switch
          on={autoSync}
          onChange={setAutoSync}
          label="⚡ ضبط تلقائي حسب المحفوظ"
          hint="يحصر المراجعة فيما حُفظ فعلاً ويمنع الخروج عنه"
        />

        {autoSync && memorized && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <div className="text-[11px] leading-relaxed text-[#5A4636] dark:text-amber-100/70">
              {hasMemorized ? (
                <>
                  نطاق المراجعة المتاح:{' '}
                  <span className="font-extrabold text-[#B8860B] dark:text-amber-200">
                    {describeMemorized(memorized)}
                  </span>
                  {memorized.boundarySurah >= 1 && (
                    <span className="block text-[#6B5B4A] dark:text-amber-100/55">
                      الدرس الجاري «{surahShort(memorized.boundarySurah)}» يُضاف إلى النطاق عند
                      إكماله
                    </span>
                  )}
                </>
              ) : (
                <>
                  لا محفوظ بعد —{' '}
                  <span className="font-extrabold text-[#B8860B] dark:text-amber-200">
                    تبدأ المراجعة من نقطة بداية الحفظ ({surahShort(hifzSurah)} {hifzAyah})
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        <TargetField
          id={`${idPrefix}-murajaah`}
          label="مقدار المراجعة اليومي"
          unit="أوجه"
          value={murajaahTarget}
          onChange={setMurajaahTarget}
          presets={[3, 5, 7.5]}
        />

        {ready && memorized ? (
          <ProgressionCard
            title="نقطة بداية المراجعة واتجاه السير"
            surah={murSurah}
            ayah={murAyah}
            direction={murDir}
            currentSurah={murCurSurah}
            currentAyah={murCurAyah}
            amount={murajaahTarget}
            unit="pages"
            onSurah={(n) => {
              murStartTouched.current = true;
              setMurSurah(n);
              setMurAyah(1);
            }}
            onAyah={(n) => {
              murStartTouched.current = true;
              setMurAyah(n);
            }}
            onDirection={(d) => {
              murDirTouched.current = true;
              setMurDir(d);
            }}
            filter={autoSync && hasMemorized ? (s) => murAllowed(s.n) > 0 : undefined}
            maxAyahFor={autoSync && hasMemorized ? murAllowed : undefined}
            bounds={
              hasMemorized && memorized
                ? { minSurah: memorized.minSurah, maxSurah: memorized.maxSurah, cycle: true }
                : undefined
            }
            warn={
              murOutOfRange
                ? `«${surahShort(murSurah)}» خارج المحفوظ — فعّل الضبط التلقائي أو غيّر السورة`
                : undefined
            }
          />
        ) : null}
      </div>

      {/* ══ القسم ٣: الحالة ══ */}
      <div className="space-y-3 rounded-2xl border border-black/10 dark:border-amber-500/20 bg-black/15 p-3.5">
        <SectionTitle n="٣" title="الحالة" sub="إيقاف الحفظ مؤقتاً" />
        <Switch
          on={paused}
          onChange={setPaused}
          label="⏸ إيقاف الحفظ مؤقتاً"
          hint="يتحوّل الطالب للمراجعة فقط، والعدّاد ينقص كل يوم حلقة"
          tone="amber"
        />

        {paused && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 ring-1 ring-inset ring-amber-500/25">
            <Pause className="h-4 w-4 shrink-0 text-amber-300" />
            <span className="shrink-0 text-xs font-bold text-[#5A4636] dark:text-amber-100/70">عدد الأيام</span>
            <button
              type="button"
              onClick={() => setPauseDays((d) => Math.max(1, Math.round(d) - 1))}
              aria-label="إنقاص عدد الأيام"
              className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/80 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <input
              type="number"
              min={1}
              max={365}
              dir="ltr"
              aria-label="عدد الأيام"
              value={Math.max(1, Math.round(pauseDays))}
              onChange={(e) => setPauseDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
              className="h-9 min-w-0 flex-1 rounded-lg border border-black/10 dark:border-amber-500/20 bg-black/[0.05] dark:bg-amber-100/10 px-2 text-center text-sm font-extrabold text-[#2D1F17] dark:text-[#F5EBE1] outline-none focus:border-amber-400/60"
            />
            <button
              type="button"
              onClick={() => setPauseDays((d) => Math.min(365, Math.round(d) + 1))}
              aria-label="زيادة عدد الأيام"
              className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] dark:bg-amber-100/10 text-[#5A4636] dark:text-amber-100/80 ring-1 ring-inset ring-black/10 dark:ring-amber-500/20 hover:bg-black/10 dark:hover:bg-amber-100/20"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <span className="shrink-0 text-[11px] font-bold text-[#6B5B4A] dark:text-amber-100/45">يوم</span>
          </div>
        )}
      </div>

      {/* ── الحفظ ── */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="press flex-1 rounded-xl bg-black/[0.05] dark:bg-amber-100/10 py-3 text-sm font-bold text-[#5A4636] dark:text-amber-100/80 hover:bg-black/10 dark:hover:bg-amber-100/20"
        >
          إلغاء
        </button>
        <button
          type="submit"
          disabled={!clean || busy}
          className="press flex-[2] rounded-xl bg-[#B8860B] py-3 text-sm font-extrabold text-white shadow-lg shadow-amber-700/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'جارٍ الحفظ…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
