// src/components/RingForm.tsx
// نموذج الحلقة **الموحّد**: نفس الحقول لأمر «إضافة حلقة» و«تعديل بيانات الحلقة»
// (كـ StudentForm تماماً) — اسم الحلقة + الفترة + أيام العمل + إتاحة التسميع في
// أيام الإجازة، فلا ينحرف النموذجان. منطقةُ الحذف تُمرَّر من الغلاف عبر children.
//
// **الألوان كلها من نظام الثيم** (فاتح/داكن) عبر أصناف Tailwind المزدوجة +
// `glass-strong` — لا لونٌ صريحٌ منفرد، فالنافذة تتبع مفتاح الثيم العام.
import { useState } from 'react';
import type { RingPeriod } from '../db/schema';

export interface RingFormValues {
  name: string;
  period: RingPeriod;
  weekStartDay: number;
  activeDays: boolean[];
  /** إتاحة التسميع في أيام الإجازة (بلا تحريك الموضع الجاري) */
  allowOffDayRecitation: boolean;
}

/** الفترات المعتمدة (أوقات الحلقات في المسجد) */
const PERIODS: { value: RingPeriod; label: string }[] = [
  { value: 'Fajr', label: 'الفجر' },
  { value: 'Dhuhr', label: 'الظهر' },
  { value: 'Asr', label: 'العصر' },
  { value: 'Maghrib', label: 'المغرب' },
  { value: 'Isha', label: 'العشاء' },
];

/** أيام العمل: السبت إلى الجمعة — بأحرفٍ مختصرة صريحة (لا قطعَ آليّ يكسر «ال»). */
const DAYS = [
  { short: 'س', label: 'السبت' },
  { short: 'ح', label: 'الأحد' },
  { short: 'ن', label: 'الاثنين' },
  { short: 'ث', label: 'الثلاثاء' },
  { short: 'ر', label: 'الأربعاء' },
  { short: 'خ', label: 'الخميس' },
  { short: 'ج', label: 'الجمعة' },
];

// ---- أصنافٌ مشتركة من نظام الثيم (فاتح + داكن) ----
const LABEL = 'mb-2 block text-sm font-bold text-[#6B5B4A] dark:text-amber-100/80';
const INPUT =
  'w-full rounded-xl border border-amber-900/15 bg-white/70 px-4 py-3 text-[#2D1F17] placeholder-[#9c8b7a] outline-none transition focus:border-[#B8860B]/70 focus:bg-white focus:ring-2 focus:ring-[#B8860B]/30 dark:border-amber-500/20 dark:bg-white/5 dark:text-[#F5EBE1] dark:placeholder-amber-200/40 dark:focus:bg-white/10';
const CHIP_ON = 'bg-[#B8860B] text-white ring-transparent shadow-md shadow-amber-700/30';
const CHIP_OFF =
  'bg-black/[0.04] text-[#6B5B4A] ring-black/10 hover:bg-black/[0.07] dark:bg-white/5 dark:text-amber-100/70 dark:ring-white/15 dark:hover:bg-white/10';
const BTN_GHOST =
  'press flex-1 rounded-xl bg-black/[0.04] py-3 text-sm font-bold text-[#6B5B4A] hover:bg-black/[0.07] dark:bg-white/5 dark:text-amber-100/80 dark:hover:bg-white/10';

export default function RingForm({
  initial,
  submitLabel,
  onSubmit,
  onClose,
  children,
}: {
  initial?: Partial<RingFormValues>;
  submitLabel: string;
  onSubmit: (values: RingFormValues) => void | Promise<void>;
  onClose: () => void;
  /** تحت الأزرار: منطقة الحذف الآمنة (تُمرَّر من غلاف التعديل فقط). */
  children?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [period, setPeriod] = useState<RingPeriod>(initial?.period ?? 'Fajr');
  // [السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة]
  const [activeDays, setActiveDays] = useState<boolean[]>(
    initial?.activeDays ? [...initial.activeDays] : [true, false, true, false, true, false, false],
  );
  /** إتاحة التسميع في أيام الإجازة — مُطفأة افتراضاً (التسميع مُقفل في الإجازة) */
  const [allowOffDay, setAllowOffDay] = useState<boolean>(!!initial?.allowOffDayRecitation);
  const [saving, setSaving] = useState(false);

  const toggleDay = (i: number) => {
    const next = [...activeDays];
    next[i] = !next[i];
    setActiveDays(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        period,
        weekStartDay: initial?.weekStartDay ?? 0,
        activeDays,
        allowOffDayRecitation: allowOffDay,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* اسم الحلقة */}
        <div>
          <label htmlFor="ring-name" className={LABEL}>
            اسم الحلقة
          </label>
          <input
            id="ring-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: حلقة الفجر"
            required
            className={INPUT}
          />
        </div>

        {/* الفترة */}
        <div>
          <span className={LABEL}>الفترة</span>
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => {
              const selected = period === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPeriod(p.value)}
                  className={`press rounded-full px-4 py-2 text-sm font-bold ring-1 ring-inset transition-all ${
                    selected ? CHIP_ON : CHIP_OFF
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* أيام العمل */}
        <div>
          <span className={LABEL}>أيام العمل</span>
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((day, i) => {
              const active = activeDays[i];
              return (
                <button
                  key={day.label}
                  type="button"
                  title={day.label}
                  aria-label={day.label}
                  aria-pressed={active}
                  onClick={() => toggleDay(i)}
                  className={`press flex aspect-square items-center justify-center rounded-full text-base font-extrabold ring-1 ring-inset transition-all ${
                    active ? CHIP_ON : CHIP_OFF
                  }`}
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[#8a7261] dark:text-amber-100/40">من السبت إلى الجمعة</p>
        </div>

        {/* إتاحة التسميع في أيام الإجازة — مفتاحٌ واحد بلا شرحٍ زائد */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-900/10 bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <span id="offday-label" className="text-sm font-bold text-[#3A2A1E] dark:text-amber-100/85">
            إتاحة التسميع في أيام الإجازة
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={allowOffDay}
            aria-labelledby="offday-label"
            onClick={() => setAllowOffDay((v) => !v)}
            className={`press relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
              allowOffDay
                ? 'bg-[#B8860B]'
                : 'bg-stone-300 dark:bg-white/15'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${
                allowOffDay ? 'right-1' : 'right-6'
              }`}
            />
          </button>
        </div>

        {/* الأزرار */}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            إلغاء
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="press flex-[2] rounded-xl bg-[#B8860B] py-3 text-sm font-extrabold text-white shadow-lg shadow-amber-700/30 hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ…' : submitLabel}
          </button>
        </div>
      </form>

      {children}
    </>
  );
}
