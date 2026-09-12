// src/components/BackupModal.tsx
// «نسخة احتياطية» — تصدير قاعدة مُدَبِّر كاملةً إلى ملفّ، واستعادتها منه.
// الثيم فاتح/داكن (glass-strong + الأصناف المزدوجة)، والاستعادة تمرّ بتأكيدٍ
// صريح يعرض محتوى الملفّ بالضبط قبل أن تُستبدل البيانات.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DatabaseBackup, Download, Upload, X } from 'lucide-react';
import { pruneAttendance } from '../db/index';
import {
  backupFileName,
  currentCounts,
  downloadBlob,
  exportBackup,
  readBackup,
  restoreBackup,
  type BackupSummary,
} from '../db/backup';

const AR = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
const NAMES: Record<string, string> = {
  ring: 'حلقات',
  rings: 'حلقات',
  student: 'طلاب',
  students: 'طلاب',
  session: 'جلسات',
  sessions: 'جلسات',
  attendance: 'سجلّ حضور',
};

export default function BackupModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; summary: BackupSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDone(null);
    setError(null);
    setPending(null);
    // فحصُ تنظيفٍ قبل العرض: يُدمج المكرّر ويُزيل اليتيم فتصدُق الأرقام
    void pruneAttendance()
      .catch(() => undefined)
      .then(() => currentCounts())
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const doExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportBackup();
      downloadBlob(blob, backupFileName());
      setDone(`تم تنزيل النسخة (${Math.max(1, Math.round(blob.size / 1024))} كيلوبايت) ✓`);
    } catch (e) {
      setError('تعذّر إنشاء النسخة الاحتياطية: ' + String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const summary = await readBackup(file, file.lastModified);
      setPending({ file, summary });
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doRestore = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(pending.file);
      setDone('تمت الاستعادة ✓ — سيُحدَّث التطبيق الآن…');
      setPending(null);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setError('تعذّرت الاستعادة: ' + String(e));
      setBusy(false);
    }
  };

  const chip = 'rounded-xl bg-black/[0.04] px-3 py-2 text-center dark:bg-white/5';
  const chipLabel = 'text-[11px] font-bold text-[#8a7261] dark:text-amber-100/50';
  const chipValue = 'text-base font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]';

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="نسخة احتياطية"
        className="animate-slide-up glass-strong relative max-h-[92dvh] w-full max-w-lg overflow-y-auto p-6 pb-8"
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-black/15 dark:bg-amber-200/40 sm:hidden" />

        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
              <DatabaseBackup className="h-5 w-5 text-[#B8860B]" />
              نسخة احتياطية
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-[#6B5B4A] dark:text-amber-100/60">
              الحلقات · الطلاب · الجلسات · الحضور
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#6B5B4A] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100/70 dark:hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ما في الجهاز الآن */}
        {counts ? (
          <div className="mb-5 grid grid-cols-4 gap-2">
            {Object.entries(counts).map(([k, v]) => (
              <div key={k} className={chip} data-count={k}>
                <p className={chipLabel}>{k}</p>
                <p className={chipValue}>{AR(v)}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* التصدير */}
        <button
          onClick={() => void doExport()}
          disabled={busy}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-[#B8860B] py-3 text-base font-extrabold text-white shadow-lg shadow-amber-700/30 hover:brightness-110 disabled:opacity-60"
        >
          <Download className="h-5 w-5" />
          تنزيل نسخة احتياطية
        </button>

        {/* الاستعادة */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || !!pending}
          className="press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-black/[0.05] py-3 text-base font-extrabold text-[#5A4636] hover:bg-black/10 disabled:opacity-60 dark:bg-white/10 dark:text-amber-100 dark:hover:bg-white/20"
        >
          <Upload className="h-5 w-5" />
          استعادة من ملفّ
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />

        {/* ملخّص الملفّ + التأكيد */}
        {pending ? (
          <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4">
            <p className="text-sm font-extrabold text-rose-800 dark:text-rose-200">
              ستُستبدل بيانات الجهاز بمحتوى هذا الملفّ
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {Object.entries(pending.summary.tables).map(([k, v]) => (
                <div key={k} className={chip} data-backup-count={k}>
                  <p className={chipLabel}>{NAMES[k] ?? k}</p>
                  <p className={chipValue}>{AR(v)}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] font-bold text-rose-800/70 dark:text-rose-200/70">
              إجمالي {AR(pending.summary.total)} صفاً
              {pending.summary.exportedAt
                ? ` · بتاريخ ${pending.summary.exportedAt.slice(0, 10)}`
                : ''}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setPending(null)}
                className="press flex-1 rounded-xl bg-black/[0.05] py-2.5 text-sm font-bold text-[#5A4636] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100"
              >
                إلغاء
              </button>
              <button
                onClick={() => void doRestore()}
                disabled={busy}
                className="press flex-[2] rounded-xl bg-rose-600 py-2.5 text-sm font-extrabold text-white hover:brightness-110 disabled:opacity-60"
              >
                {busy ? 'جارٍ الاستعادة…' : 'استعادة الآن'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-800 dark:text-rose-200">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="mt-4 rounded-2xl bg-green-700/10 px-4 py-3 text-sm font-extrabold text-green-800 dark:text-green-300">
            {done}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
