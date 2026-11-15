// src/components/EditStudentModal.tsx
// تعديل بيانات الطالب — الغلاف + منطقة الحذف الآمنة (البوابة الوحيدة للحذف).
// النموذج نفسه (الهوية + أقسام الحفظ/المراجعة/الحالة) يأتي من StudentForm
// المشترك، فهو نفس النموذج المستخدم في «إضافة طالب جديد» حرفياً.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Pencil, Trash2 } from 'lucide-react';
import { archiveStudent, deleteStudentWithRecords, restoreStudent } from '../db';
import { notify } from '../utils/toast';
import type { Student } from '../db/schema';
import StudentForm from './StudentForm';

export default function EditStudentModal({
  isOpen,
  student,
  onClose,
  onSaved,
  onDeleted,
  onArchived,
}: {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
  /** بعد الأرشفة أو التراجع عنها — لإعادة قراءة قائمة الحلقة */
  onArchived?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!isOpen || !student) return null;

  const handleArchive = async () => {
    if (deleting) return;
    const id = student.id;
    const name = student.name;
    setDeleting(true);
    try {
      await archiveStudent(id);
      onArchived?.();
      onClose();
      notify(`أُرشف «${name}» — سجلاته محفوظة.`, 'success', {
        ms: 8000,
        action: {
          label: 'تراجع',
          run: () => {
            void restoreStudent(id)
              .then(() => onArchived?.())
              .catch(() => notify('تعذّر التراجع عن الأرشفة.', 'error'));
          },
        },
      });
    } catch {
      notify('تعذّرت الأرشفة. حاول مرة أخرى.', 'error');
    } finally {
      setDeleting(false);
    }
  };

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
        className="animate-slide-up relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-amber-900/10 bg-amber-50/95 p-6 pb-8 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:border dark:border-white/10 dark:bg-[#241A14]/95"
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-black/15 dark:bg-amber-200/40 sm:hidden" />

        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
            <Pencil className="h-5 w-5 text-[#B8860B]" />
            تعديل بيانات الطالب
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#6B5B4A] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100/70 dark:hover:bg-white/20"
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

        {/* ---- إزالة الطالب: خياران — أرشفة (قابلة للتراجع) أو حذفٌ نهائيّ ---- */}
        <div className="mt-6 border-t border-black/10 pt-4 dark:border-amber-500/20">
          <p className="mb-3 text-xs font-bold text-[#6B5B4A] dark:text-amber-100/60">إزالة الطالب من الحلقة</p>

          <button
            type="button"
            onClick={() => void handleArchive()}
            disabled={deleting}
            className="press flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 py-3 text-sm font-bold text-amber-900 transition hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-200"
          >
            <Archive className="h-4 w-4" />
            أرشفة الطالب
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#8a7261] dark:text-amber-100/50">
            يختفي من الحلقة وتبقى جلساته وحضوره محفوظة، ويمكن استعادته من «الأرشيف» متى شئت.
          </p>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 py-3 text-sm font-bold text-rose-800 transition hover:bg-rose-500/20 dark:text-rose-300"
            >
              <Trash2 className="h-4 w-4" />
              حذف نهائي
            </button>
          ) : (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="mb-3 text-sm font-bold text-rose-800 dark:text-rose-200">
                هل أنت متأكد من الحذف النهائي؟
              </p>
              <p className="mb-3 text-xs leading-relaxed text-rose-800/70 dark:text-rose-200/70">
                سيُحذف «{student.name}» وكل جلسات التسميع وسجلّ الحضور المسجّلة له نهائياً.
                لا يمكن التراجع — وإن أردت الاحتفاظ بسجلاته فاختر «أرشفة الطالب».
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="press flex-1 rounded-full bg-black/[0.05] py-2 text-xs font-bold text-[#5A4636] hover:bg-black/10 dark:bg-amber-100/10 dark:text-amber-100/80 dark:hover:bg-amber-100/20"
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
