// src/components/ToastHost.tsx
import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from '../utils/toast';

const TONE: Record<ToastItem['kind'], string> = {
  error: 'bg-rose-700 text-white',
  success: 'bg-green-700 text-white',
  info: 'bg-[#2D1F17] text-[#F5EBE1]',
};

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (!items.length) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[200] flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold shadow-xl ${TONE[t.kind]}`}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action ? (
            <button
              onClick={() => {
                dismissToast(t.id);
                t.action?.run();
              }}
              className="shrink-0 rounded-lg bg-white/20 px-3 py-1 font-extrabold hover:bg-white/30"
            >
              {t.action.label}
            </button>
          ) : null}
          <button onClick={() => dismissToast(t.id)} aria-label="إغلاق" className="shrink-0 opacity-70">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
