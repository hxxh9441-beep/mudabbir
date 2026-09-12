// src/components/RingCard.tsx
import { Pencil } from 'lucide-react';
import type { Ring } from '../db/schema';

const periodLabels: Record<string, string> = {
  Fajr: 'الفجر',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء',
};

// Warm caramel/amber period tag styles
const periodStyles: Record<string, string> = {
  Fajr: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  Dhuhr: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-200',
  Asr: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
  Maghrib: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  Isha: 'bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-200',
};

// Ordered السبت → الجمعة to match stored activeDays
const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export default function RingCard({
  ring,
  onClick,
  onEdit,
}: {
  ring: Ring;
  onClick: () => void;
  /** [✏️] تعديل بيانات الحلقة — لا يفتح الحلقة (يوقف انتشار النقر). */
  onEdit?: () => void;
}) {
  const activeDays = days.filter((_, i) => ring.activeDays?.[i]);
  const label = periodLabels[ring.period] ?? ring.period;
  const style = periodStyles[ring.period] ?? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200';

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className="glass press group cursor-pointer p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8860B]/60"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-lg font-extrabold leading-tight text-[#2D1F17] dark:text-[#F5EBE1]">
          {ring.name}
        </h2>
        {/* شارة الفترة + زرّ التعديل في طرف البطاقة */}
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${style}`}>{label}</span>
          {onEdit && (
            <button
              type="button"
              aria-label="تعديل بيانات الحلقة"
              title="تعديل بيانات الحلقة"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="press flex h-8 w-8 items-center justify-center rounded-full border border-amber-900/10 bg-amber-50/70 text-[#8a6508] transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-[#241A14]/70 dark:text-amber-300 dark:hover:bg-[#2f2118]"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>

      <div className="space-y-1.5 text-sm text-[#5c4a3a] dark:text-amber-100/70">
        <p>
          <span className="font-semibold text-[#7a6450] dark:text-amber-100/50">أيام العمل: </span>
          {activeDays.length > 0 ? activeDays.join('، ') : '—'}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-end">
        <span className="text-sm font-bold text-[#B8860B] transition-transform duration-200 group-hover:-translate-x-1 dark:text-amber-300">
          فتح الحلقة ←
        </span>
      </div>
    </div>
  );
}
