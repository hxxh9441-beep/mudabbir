// src/components/AddStudentModal.tsx
// إضافة طالب جديد — نفس نموذج التعديل حرفياً (StudentForm المشترك): المرحلة
// والصف، أهداف الحفظ/المراجعة مع السور والاتجاه، الضبط الذكي للمراجعة،
// وإيقاف الحفظ المؤقت. الفرق الوحيد: قيمٌ افتراضية معقولة للبداية (ابتدائي/
// رابع · ٥ أسطر من الناس ١ · ٣ أوجه للمراجعة)، ولا زرَّ حذف.
import { createPortal } from 'react-dom';
import { UserPlus } from 'lucide-react';
import StudentForm from './StudentForm';

export default function AddStudentModal({
  isOpen,
  onClose,
  ringId,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  ringId: number;
  onAdded?: () => void;
}) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="إضافة طالب جديد"
        className="animate-slide-up relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-amber-500/20 bg-[#241A14]/95 p-6 pb-8 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:border sm:border-amber-500/15"
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-amber-200/40 sm:hidden" />

        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#F5EBE1]">
            <UserPlus className="h-5 w-5 text-[#B8860B]" />
            إضافة طالب جديد
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100/10 text-amber-100/70 hover:bg-amber-100/20"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        {/* النموذج الموحّد — student=null ⇒ قيم افتراضية لطالبٍ جديد */}
        <StudentForm
          student={null}
          ringId={ringId}
          idPrefix="add"
          submitLabel="حفظ الطالب"
          onClose={onClose}
          onSaved={() => onAdded?.()}
        />
      </div>
    </div>,
    document.body,
  );
}
