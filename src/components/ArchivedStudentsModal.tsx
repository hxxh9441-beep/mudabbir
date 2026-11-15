// src/components/ArchivedStudentsModal.tsx
// أرشيف الحلقة: الطلاب المؤرشَفون مع خيارين لكلٍّ منهم — استعادة، أو حذفٌ نهائيّ
// (بتأكيدٍ صريح). كل ما يخصّ الطالب من جلساتٍ وحضورٍ باقٍ ما دام مؤرشَفاً.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, RotateCcw, Trash2, X } from 'lucide-react';
import { deleteStudentWithRecords, restoreStudent } from '../db';
import type { Student } from '../db/schema';
import { notify } from '../utils/toast';

const dateOf = (d: Date | undefined) => (d ? new Date(d).toLocaleDateString('ar-SA') : '');

export default function ArchivedStudentsModal({
  isOpen,
  students,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  students: Student[];
  onClose: () => void;
  /** بعد استعادةٍ أو حذف — لإعادة قراءة قائمة الحلقة */
  onChanged: () => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  if (!isOpen) return null;

  const restore = async (s: Student) => {
    if (s.id === undefined || busyId !== null) return;
    setBusyId(s.id);
    try {
      await restoreStudent(s.id);
      onChanged();
      if (students.length <= 1) onClose(); // كان آخر مؤرشَف
      notify(`استُعيد «${s.name}» إلى الحلقة.`, 'success');
    } catch {
      notify('تعذّرت الاستعادة. حاول مرة أخرى.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (s: Student) => {
    if (s.id === undefined || busyId !== null) return;
    setBusyId(s.id);
    try {
      await deleteStudentWithRecords(s.id);
      setConfirmId(null);
      onChanged();
      if (students.length <= 1) onClose(); // كان آخر مؤرشَف
      notify(`حُذف «${s.name}» نهائياً.`, 'info');
    } catch {
      notify('تعذّر الحذف. حاول مرة أخرى.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="أرشيف الطلاب"
        className="animate-slide-up relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-amber-900/10 bg-amber-50/95 p-6 pb-8 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:border dark:border-white/10 dark:bg-[#241A14]/95"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
            <Archive className="h-5 w-5 text-[#B8860B]" />
            الأرشيف
          </h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-[#6B5B4A] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100/70 dark:hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {students.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-[#6B5B4A] dark:text-amber-100/60">
            لا يوجد طلاب مؤرشَفون.
          </p>
        ) : (
          <ul className="space-y-3">
            {students.map((s) => (
              <li key={s.id} data-archived-student={s.id} className="rounded-2xl bg-black/[0.04] p-3 dark:bg-white/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">{s.name}</p>
                    <p className="text-[11px] font-semibold text-[#8a7261] dark:text-amber-100/50">
                      {s.level ? `${s.level} · ` : ''}أُرشف {dateOf(s.archivedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void restore(s)}
                      disabled={busyId !== null}
                      className="press flex items-center gap-1 rounded-full bg-[#B8860B] px-3 py-1.5 text-xs font-extrabold text-white hover:brightness-110 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      استعادة
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(confirmId === s.id ? null : (s.id ?? null))}
                      disabled={busyId !== null}
                      aria-label={`حذف ${s.name} نهائياً`}
                      className="press flex items-center gap-1 rounded-full bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-800 dark:text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف
                    </button>
                  </div>
                </div>

                {confirmId === s.id ? (
                  <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                    <p className="text-xs leading-relaxed text-rose-800/80 dark:text-rose-200/80">
                      سيُحذف «{s.name}» وكل جلساته وحضوره نهائياً، ولا يمكن التراجع.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="press flex-1 rounded-full bg-black/[0.05] py-1.5 text-xs font-bold text-[#5A4636] dark:bg-amber-100/10 dark:text-amber-100/80"
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(s)}
                        disabled={busyId !== null}
                        className="press flex-1 rounded-full bg-rose-600 py-1.5 text-xs font-extrabold text-white disabled:opacity-50"
                      >
                        حذف نهائي
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
