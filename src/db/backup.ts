// src/db/backup.ts
// النسخ الاحتياطي والاستعادة لقاعدة مُدَبِّر (Dexie / IndexedDB) عبر الحزمة
// الرسمية `dexie-export-import`.
//
// • التصدير: يُنتج ملفّ JSON واحداً يحوي **الجداول الأربعة كاملةً** (الحلقات،
//   الطلاب، الجلسات، الحضور) — قابل للتنزيل والاحتفاظ خارج الجهاز.
// • الاستعادة: تُفرِّغ الجداول ثم تُودع محتوى الملفّ، فيعود كل شيء كما كان.
// • قبل الاستعادة نقرأ رأس الملفّ (بلا استيراد) لنعرض للمعلّم ما فيه بالضبط
//   ويؤكّد — فلا تُفقد بياناتٌ بضغطةٍ عابرة.
import { exportDB, importInto } from 'dexie-export-import';
import { db } from './index';

export interface BackupSummary {
  /** الإصدار بصيغة dexie */
  formatVersion: number;
  /** أسماء قاعدة البيانات كما كُتبت في الملفّ */
  databaseName: string;
  /** عدد الصفوف في كل جدول: { ring: 2, student: 5, … } */
  tables: Record<string, number>;
  /** مجموع الصفوف */
  total: number;
  /** تاريخ التصدير كما هو مخزَّن (ISO) أو null */
  exportedAt: string | null;
}

/** الملفّ الاحتياطيّ كاملاً — Blob جاهز للتنزيل. */
export async function exportBackup(): Promise<Blob> {
  return exportDB(db, { prettyJson: false });
}

/** اسم الملفّ المقترح: «مدبّر-نسخة-2026-09-12.json» */
export function backupFileName(date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  return `مدبّر-نسخة-${d}.json`;
}

/** تنزيل Blob باسمٍ محدَّد. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * أرقام الجهاز كما تهمّ المعلّم — لا أعداداً خامّة:
 *   • حلقة / طالب / جلسة: عدد السجلات كما هي.
 *   • **أيام حضور**: عدد **الأيام المُسجَّلة** (قيم `date` المتمايزة) لا عدد
 *     صفوف الجدول — فصفوف الحضور صفٌّ لكل طالبٍ في اليوم، وعدُّها خامّاً كان
 *     يُنتج رقماً متضخّماً لا معنى له (٩٢ صفّاً لثلاثة طلاب!). والصفوف
 *     اليتيمة/المكرّرة تُنقّى بـ`pruneAttendance()` قبل الحساب.
 */
export async function currentCounts(): Promise<Record<string, number>> {
  const [rings, students, sessions, days] = await Promise.all([
    db.ring.count(),
    db.student.count(),
    db.session.count(),
    db.attendance.orderBy('date').uniqueKeys(),
  ]);
  return { حلقة: rings, طالب: students, جلسة: sessions, 'أيام حضور': days.length };
}

/**
 * قراءة رأس الملفّ الاحتياطيّ بلا استيراد: نتحقّق أنه ملفّ dexie صالح ونُحصي
 * ما فيه، فنعرضه للمعلّم قبل الاستعادة.
 */
export async function readBackup(file: Blob, fileLastModified?: number): Promise<BackupSummary> {
  const text = await file.text();
  let parsed: {
    formatName?: string;
    formatVersion?: number;
    exportDate?: string;
    data?: {
      databaseName?: string;
      exportDate?: string;
      tables?: { name: string; rowCount?: number }[];
    };
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error('الملفّ ليس ملفّ نسخةٍ احتياطيّة صالحاً (تعذّر قراءته).');
  }
  if (parsed.formatName !== 'dexie' || !parsed.data?.tables) {
    throw new Error('الملفّ ليس نسخةً احتياطيّة من مُدَبِّر.');
  }
  const tables: Record<string, number> = {};
  let total = 0;
  for (const t of parsed.data.tables) {
    const n = t.rowCount ?? 0;
    tables[t.name] = n;
    total += n;
  }
  return {
    formatVersion: parsed.formatVersion ?? 1,
    databaseName: parsed.data.databaseName ?? '—',
    tables,
    total,
    exportedAt:
      parsed.data.exportDate ??
      (parsed as { exportDate?: string }).exportDate ??
      (fileLastModified ? new Date(fileLastModified).toISOString() : null),
  };
}

/**
 * **الاستعادة الفعليّة**: تُفرَّغ الجداول الحاليّة ثم يُستورد محتوى الملفّ.
 * `clearTablesBeforeImport` يجعلها استعادةً كاملةً لا دمجاً — فيعود الجهاز إلى
 * حالته لحظة أخذ النسخة بالضبط.
 */
export async function restoreBackup(file: Blob): Promise<void> {
  await importInto(db, file, { clearTablesBeforeImport: true });
}
