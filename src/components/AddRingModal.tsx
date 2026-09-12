// src/components/AddRingModal.tsx
// «إضافة حلقة جديدة» — غلافٌ رقيق حول RingForm الموحّد (كما AddStudentModal).
// الهيكل من `glass-strong` فهو يتبع الثيم الفاتح/الداكن تلقائياً.
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import RingForm, { type RingFormValues } from './RingForm';

export default function AddRingModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (ring: RingFormValues) => void | Promise<void>;
}) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="إضافة حلقة جديدة"
        className="animate-slide-up glass-strong relative max-h-[92dvh] w-full max-w-lg overflow-y-auto p-6 pb-8"
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-black/15 dark:bg-amber-200/40 sm:hidden" />

        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
            <Plus className="h-5 w-5 text-[#B8860B]" />
            إضافة حلقة جديدة
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#6B5B4A] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100/70 dark:hover:bg-white/20"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        <RingForm submitLabel="إضافة الحلقة" onSubmit={onAdd} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
