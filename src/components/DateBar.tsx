// src/components/DateBar.tsx
// شريط التاريخ في لوحة الحلقة: < الخميس، 10 سبتمبر 2026 > مع أسهم سريعة
// ومنتقي تاريخ. كل سجلات الحضور والتسميع تُفتح على التاريخ المختار.
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = [
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

/** yyyy-mm-dd → Date محلي (بلا انزياح مناطق زمنية) */
export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** إزاحة يوم */
export function shiftDay(key: string, delta: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + delta);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «الخميس، 10 سبتمبر 2026» */
export function formatDayLong(key: string): string {
  const d = parseDay(key);
  return `${AR_DAYS[d.getDay()]}، ${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** «10 سبتمبر» */
export function formatDayShort(key: string): string {
  const d = parseDay(key);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
}

export default function DateBar({
  value,
  onChange,
  today,
  isCircleDay,
}: {
  value: string;
  onChange: (next: string) => void;
  today: string;
  /** هل التاريخ المختار يوم حلقة (لعرض تنبيه لطيف)؟ */
  isCircleDay?: boolean;
}) {
  const isToday = value === today;
  // أزرار الأسهم: ورقٌ دافئ بحدٍّ واضح في النهاري، وزجاج داكن في الليلي —
  // والنصّ بنّي غامق في النهاري (#5A4636) ورمليّ فاتح في الليلي.
  const arrowCls =
    'press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/35 text-[#5A4636] shadow-sm ring-1 ring-inset ring-black/10 transition hover:bg-[#B8860B]/15 hover:text-[#8a6508] dark:bg-white/5 dark:text-amber-100/80 dark:shadow-none dark:ring-white/10 dark:hover:bg-amber-400/15 dark:hover:text-amber-200';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="اليوم السابق"
        onClick={() => onChange(shiftDay(value, -1))}
        className={arrowCls}
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="relative min-w-0 flex-1">
        <div className="flex items-center justify-center gap-2 rounded-xl bg-white/35 px-3 py-2.5 backdrop-blur-sm ring-1 ring-inset ring-black/[0.08] dark:bg-white/[0.06] dark:ring-white/10">
          <CalendarDays className="h-4 w-4 shrink-0 text-[#8a6508] dark:text-amber-300/80" />
          <span className="truncate text-sm font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
            {formatDayLong(value)}
          </span>
          {isToday && (
            <span className="shrink-0 rounded-full bg-[#8a6508] px-2 py-0.5 text-[10px] font-extrabold text-white">
              اليوم
            </span>
          )}
          {!isToday && isCircleDay === false && (
            <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-700 dark:bg-white/10 dark:text-amber-100/70">
              إجازة
            </span>
          )}
        </div>
        {/* منتقي التاريخ الأصلي — شفّاف فوق الشريط كله */}
        <input
          type="date"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="اختيار تاريخ الحلقة"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <button
        type="button"
        aria-label="اليوم التالي"
        onClick={() => onChange(shiftDay(value, 1))}
        disabled={value >= today}
        className={`${arrowCls} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="press shrink-0 rounded-xl bg-[#B8860B] px-3 py-2.5 text-xs font-extrabold text-white shadow-md shadow-amber-800/20"
        >
          اليوم
        </button>
      )}
    </div>
  );
}
