// src/components/EditStudentModal.tsx
// تعديل بيانات الطالب — الغلاف + منطقة الحذف الآمنة (البوابة الوحيدة للحذف).
// النموذج نفسه (الهوية + أقسام الحفظ/المراجعة/الحالة) يأتي من StudentForm
// المشترك، فهو نفس النموذج المستخدم في «إضافة طالب جديد» حرفياً.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { deleteStudentWithRecords } from '../db';
import type { Student } from '../db/schema';
import StudentForm from './StudentForm';

export default function EditStudentModal({
  isOpen,
  student,
  onClose,
  onSaved,
  onDeleted,
}: {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!isOpen || !student) return null;

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteStudentWithRecords(student.id);
      onDeleted?.();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="تعديل بيانات الطالب"
        className="animate-slide-up relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-amber-500/20 bg-[#241A14]/95 p-6 pb-8 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:border sm:border-amber-500/15"
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-amber-200/40 sm:hidden" />

        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#F5EBE1]">
            <Pencil className="h-5 w-5 text-[#B8860B]" />
            تعديل بيانات الطالب
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100/10 text-amber-100/70 hover:bg-amber-100/20"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        {/* النموذج الموحّد — نفس ما يُعرض عند إضافة طالب */}
        <StudentForm
          key={student.id}
          student={student}
          idPrefix="edit"
          submitLabel="حفظ التعديلات"
          onClose={onClose}
          onSaved={() => onSaved?.()}
        />

        {/* ---- danger zone: the only door to deletion ---- */}
        <div className="mt-6 border-t border-rose-500/20 pt-4">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="press flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 py-3 text-sm font-bold text-rose-300 transition hover:bg-rose-500/20"
            >
              <Trash2 className="h-4 w-4" />
              حذف الطالب
            </button>
          ) : (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="mb-3 text-sm font-bold text-rose-200">
                هل أنت متأكد من حذف الطالب وسجلاته؟
              </p>
              <p className="mb-3 text-xs leading-relaxed text-rose-200/70">
                سيُحذف «{student.name}» وكل جلسات التسميع المسجّلة له نهائياً. لا يمكن التراجع.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="press flex-1 rounded-full bg-amber-100/10 py-2 text-xs font-bold text-amber-100/80 hover:bg-amber-100/20"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="press flex-1 rounded-full bg-rose-600 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? 'جارٍ الحذف…' : 'حذف نهائي'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
