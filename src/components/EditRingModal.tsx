// src/components/EditRingModal.tsx
// «تعديل بيانات الحلقة» — الغلاف + منطقة الحذف الآمنة (البوابة الوحيدة لحذف حلقة).
// النموذج نفسه يأتي من RingForm المشترك، فهو حرفياً ما يُعرض في «إضافة حلقة».
// الحذف يمرّ بمربّع تأكيدٍ صريح (Alert Dialog) ثم حذفٌ تتابعيّ (طلاب الحلقة
// وسجلاتهم) داخل معاملةٍ واحدة في Dexie.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Trash2 } from 'lucide-react';
import { db, deleteRingCascade, persistRingEdit } from '../db';
import type { Ring } from '../db/schema';
import RingForm, { type RingFormValues } from './RingForm';
import { toArabicDigits } from '../data/mushafData';

export default function EditRingModal({
  isOpen,
  ring,
  onClose,
  onSaved,
  onDeleted,
}: {
  isOpen: boolean;
  ring: Ring | null;
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ringId = ring?.id;
  const studentCount = useLiveQuery(
    async () => (ringId === undefined ? 0 : db.student.where('ringId').equals(ringId).count()),
    [ringId],
    0,
  );

  if (!isOpen || !ring) return null;

  const handleSave = async (values: RingFormValues) => {
    await persistRingEdit(ring.id, values);
    onSaved?.();
    onClose();
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteRingCascade(ring.id);
      onDeleted?.();
      onClose();
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const total = studentCount ?? 0;

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="تعديل بيانات الحلقة"
            className="animate-slide-up glass-strong relative max-h-[92dvh] w-full max-w-lg overflow-y-auto p-6 pb-8"
          >
            <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-black/15 dark:bg-amber-200/40 sm:hidden" />

            <div className="mb-5 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
                <Pencil className="h-5 w-5 text-[#B8860B]" />
                تعديل بيانات الحلقة
              </h2>
              <button
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#6B5B4A] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100/70 dark:hover:bg-white/20"
                aria-label="إغلاق"
              >
                ✕
              </button>
            </div>

            {/* النموذج الموحّد — نفس ما يُعرض عند إضافة حلقة */}
            <RingForm
              key={ring.id}
              initial={{
                name: ring.name,
                period: ring.period,
                weekStartDay: ring.weekStartDay,
                activeDays: ring.activeDays,
                allowOffDayRecitation: !!ring.allowOffDayRecitation,
              }}
              submitLabel="حفظ التعديلات"
              onSubmit={handleSave}
              onClose={onClose}
            >
              {/* ---- منطقة الحذف: البوابة الوحيدة ---- */}
              <div className="mt-6 border-t border-rose-500/20 pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="press flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.08] py-3 text-sm font-bold text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                  حذف الحلقة
                </button>
                <p className="mt-2 text-center text-xs text-rose-800/60 dark:text-rose-200/50">
                  يُحذف معها طلابُها ({toArabicDigits(total)}) وسجلّاتهم
                </p>
              </div>
            </RingForm>
          </div>
        </div>,
        document.body,
      )}

      {/* ---- مربّع تأكيد الحذف (فوق النموذج) ---- */}
      {confirmOpen &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/65 backdrop-blur-sm"
              onClick={() => !deleting && setConfirmOpen(false)}
              aria-hidden
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label="تأكيد حذف الحلقة"
              className="animate-slide-up glass-strong relative w-full max-w-md border-rose-500/25 p-6"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300">
                  <Trash2 className="h-5 w-5" />
                </span>
                <h3 className="text-lg font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">تأكيد الحذف</h3>
              </div>

              <p className="text-sm font-bold leading-relaxed text-rose-800 dark:text-rose-100">
                هل أنت متأكد من حذف هذه الحلقة؟ سيتم إزالة الحلقة وبيانات طلابها
              </p>
              <p className="mt-2 text-xs leading-relaxed text-rose-800/70 dark:text-rose-200/70">
                «{ring.name}» ومعه {toArabicDigits(total)} طالباً: كل جلسات التسميع وسجلّات
                الحضور. لا يمكن التراجع عن هذا الإجراء.
              </p>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={deleting}
                  className="press flex-1 rounded-xl bg-black/[0.05] py-3 text-sm font-bold text-[#6B5B4A] hover:bg-black/10 disabled:opacity-50 dark:bg-white/5 dark:text-amber-100/80 dark:hover:bg-white/10"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="press flex-1 rounded-xl bg-rose-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-rose-900/40 hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? 'جارٍ الحذف…' : 'حذف الحلقة نهائياً'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
