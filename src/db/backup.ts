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
import { backfillSessionDays, db } from './index';

export interface BackupSummary {
  /** الإصدار بصيغة dexie */
  formatVersion: number;
  /** أسماء قاعدة البيانات كما كُتبت في الملفّ */
  databaseName: string;
  /** إصدار مخطّط قاعدة البيانات داخل الملفّ (Dexie version) */
  databaseVersion: number | null;
  /** عدد الصفوف في كل جدول: { ring: 2, student: 5, … } */
  tables: Record<string, number>;
  /** مجموع الصفوف */
  total: number;
  /** تاريخ التصدير كما هو مخزَّن (ISO) أو null */
  exportedAt: string | null;
}

const LAST_BACKUP_KEY = 'mudabbir:lastBackupAt';
/** بعد كم يوماً نُذكّر المعلّم بأخذ نسخة */
export const BACKUP_REMINDER_DAYS = 7;

/** الملفّ الاحتياطيّ كاملاً — Blob جاهز للتنزيل. */
export async function exportBackup(): Promise<Blob> {
  return exportDB(db, { prettyJson: false });
}

/** تُستدعى بعد تنزيل نسخةٍ فعلاً (لا عند مجرّد التصدير). */
export function markBackupDone(when = new Date()): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, when.toISOString());
  } catch {
    /* التخزين غير متاح — التذكير فقط يتأثّر */
  }
}

/** عدد الأيام منذ آخر نسخة، أو null إن لم تُؤخذ نسخةٌ قطّ. */
export function daysSinceBackup(now = new Date()): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return null;
    return Math.floor((now.getTime() - t) / 86400000);
  } catch {
    return null;
  }
}

/**
 * يطلب من المتصفّح ألّا يمسح بيانات التطبيق عند ضيق المساحة (IndexedDB
 * «best-effort» افتراضياً). لا يضرّ إن رُفض الطلب أو لم يُدعَم.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
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
      databaseVersion?: number;
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
  const fileVersion = parsed.data.databaseVersion ?? null;
  if (fileVersion !== null && fileVersion > db.verno) {
    throw new Error(
      'هذه النسخة أُخذت من إصدارٍ أحدث من التطبيق — حدّث التطبيق أولاً ثم أعد المحاولة.',
    );
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
    databaseVersion: fileVersion,
    tables,
    total,
    exportedAt:
      parsed.data.exportDate ??
      (parsed as { exportDate?: string }).exportDate ??
      (fileLastModified ? new Date(fileLastModified).toISOString() : null),
  };
}

/**
 * **الاستعادة الفعليّة** — آمنة: قبل أيّ مسحٍ نُصدِّر الحالة الحاليّة في الذاكرة،
 * فإن فشل الاستيراد (ملفٌّ تالف/قيدٌ مخالف) أُعيدت البيانات كما كانت بدل أن
 * يبقى الجهاز فارغاً. `clearTablesBeforeImport` يجعلها استعادةً كاملةً لا دمجاً.
 *
 * @returns نسخةُ ما قبل الاستعادة (لتنزيلها كشبكة أمانٍ إضافيّة إن شاء المستدعي)
 */
export async function restoreBackup(file: Blob): Promise<{ snapshot: Blob }> {
  const snapshot = await exportDB(db, { prettyJson: false });
  try {
    await importInto(db, file, { clearTablesBeforeImport: true });
    // نسخٌ أُخذت قبل الإصدار ٥ لا تحمل `day` — نملؤه كي تجدها الفهارس
    await backfillSessionDays();
  } catch (e) {
    try {
      await importInto(db, snapshot, { clearTablesBeforeImport: true });
    } catch (rollbackError) {
      throw new Error(
        `فشلت الاستعادة وتعذّر التراجع التلقائي أيضاً (${String(rollbackError)}). ` +
          'لا تُغلق الصفحة قبل تنزيل نسخةٍ احتياطيّة.',
      );
    }
    throw new Error(
      `${e instanceof Error ? e.message : String(e)} — أُعيدت بياناتك كما كانت قبل المحاولة.`,
    );
  }
  return { snapshot };
}
