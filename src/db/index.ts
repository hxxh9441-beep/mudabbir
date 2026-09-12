// src/db/index.ts
import { Dexie } from 'dexie';
import type {
  Ring,
  Student,
  Session,
  StudentStatus,
  DailyResult,
  Attendance,
} from './schema';
import { tables, tablesV2, tablesV3, tablesV4 } from './schema';
import { isWorkDay } from '../utils/ringDays';

/** تاريخ محلي بصيغة yyyy-mm-dd — مفتاح كل ما هو «يومي» في التطبيق */
export const isoDay = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Define the database
export class QuranCircleDB extends Dexie {
  // Table properties (bound explicitly in the constructor — no decorators needed)
  ring!: Dexie.Table<Ring, number>;
  student!: Dexie.Table<Student, number>;
  session!: Dexie.Table<Session, number>;
  attendance!: Dexie.Table<Attendance, number>;

  constructor() {
    super('QuranCircleDB');
    this.version(1).stores(tables);
    // الإصدار ٢: جدول حضور لكل تاريخ (للمراجعة والتعديل بأثر رجعي).
    // الترقية تنقل حضور اليوم الحالي من students.status حتى لا تُفقد الحالة.
    this.version(2)
      .stores(tablesV2)
      .upgrade(async (tx) => {
        // الترقية لا يجب أن تُسقط التطبيق إن فشلت — نُحيطها بحماية.
        try {
          const today = isoDay();
          const rows = (await tx.table('students').toArray()) as Student[];
          const att = rows
            .filter((s) => s.id !== undefined)
            .map((s) => ({
              studentId: s.id as number,
              date: today,
              status: (s.status ?? 'not_prepared') as StudentStatus,
              updatedAt: new Date(),
            }));
          if (att.length) await tx.table('attendance').bulkAdd(att);
        } catch (e) {
          console.warn('تعذّر ترحيل حضور اليوم — سيُبنى من جديد', e);
        }
      });
    // الإصدار ٣: تنظيف البيانات (بلا أيّ فهرسٍ جديد) — يُدمج المكرّر ويُزيل
    // اليتيم. لا بدّ أن يسبق قيدَ الفرادة، لأنّ Dexie يبني الفهارس قبل الترقية.
    this.version(3)
      .stores(tablesV3)
      .upgrade(async (tx) => {
        try {
          await pruneAttendanceTx(tx);
        } catch (e) {
          console.warn('تعذّر تنظيف الحضور في الترقية ٣', e);
        }
      });
    // الإصدار ٤: الآن فقط يُضاف القيد الفريد (البيانات صارت نظيفة في v3).
    this.version(4)
      .stores(tablesV4)
      .upgrade(async (tx) => {
        try {
          // شبكةُ أمانٍ أخيرة: لو بقيت ولو حالةُ تكرارٍ واحدة يُنظَّف قبل القيد.
          await pruneAttendanceTx(tx);
        } catch (e) {
          console.warn('تعذّر التنظيف في الترقية ٤', e);
        }
      });
    // Explicit binding: map the class properties to the declared table names.
    // (Avoids relying on decorators / matching, guaranteeing db.ring is defined.)
    this.ring = this.table('rings');
    this.student = this.table('students');
    this.session = this.table('sessions');
    this.attendance = this.table('attendance');
  }
}

// Create a single instance of the database
export const db = new QuranCircleDB();

// ---- Convenience helpers ----

// Update (or create) a student's attendance status, persisted to Dexie
export async function persistStudentStatus(
  id: number | undefined,
  status: StudentStatus,
): Promise<void> {
  if (id === undefined) return;
  await db.student.update(id, { status, lastUpdated: new Date() });
}

// Update a student's editable profile fields (name / level / daily targets).
// Kept as one helper so the Edit modal never writes a partial record.
export type StudentEditableFields = Pick<
  Student,
  | 'name'
  | 'level'
  | 'stage'
  | 'grade'
  | 'hifzTarget'
  | 'murajaahTarget'
  // محرّك التدرّج
  | 'hifzStartSurah'
  | 'hifzStartAyah'
  | 'hifzDirection'
  | 'murajaahStartSurah'
  | 'murajaahStartAyah'
  | 'murajaahDirection'
  | 'currentSurah'
  | 'currentAyah'
  | 'murajaahCurrentSurah'
  | 'murajaahCurrentAyah'
  | 'autoSyncRevision'
  | 'hifzPaused'
  | 'hifzPauseDays'
  | 'hifzPauseStartedOn'
>;

export async function persistStudentEdit(
  id: number | undefined,
  patch: StudentEditableFields,
): Promise<void> {
  if (id === undefined) return;
  await db.student.update(id, { ...patch, lastUpdated: new Date() });
}

/** إنشاء طالب جديد بنفس حقول نموذج الطالب الموحّد (إضافة = تعديل + ringId).
 *  الحالة الابتدائية «لم يُحضّر» فلا يظهر حاضراً قبل أول تسميع. */
export async function createStudent(
  ringId: number,
  patch: StudentEditableFields,
): Promise<Student | undefined> {
  const id = await db.student.add({
    ringId,
    status: 'not_prepared',
    lastUpdated: new Date(),
    ...patch,
  } as never);
  return db.student.get(id as number);
}

// Remove a student AND every recitation session recorded for them, atomically.
// (The confirmation text promises "الطالب وسجلاته", so the history goes too —
// inside one transaction, so we can never end up with orphaned sessions.)
export async function deleteStudentWithRecords(id: number | undefined): Promise<void> {
  if (id === undefined) return;
  await db.transaction('rw', db.student, db.session, db.attendance, async () => {
    await db.session.where('studentId').equals(id).delete();
    // سجلّات الحضور جزءٌ من «سجلاته» أيضاً — كانت تبقى يتيمة قبل هذا الإصلاح
    await db.attendance.where('studentId').equals(id).delete();
    await db.student.delete(id);
  });
}

// ---- تنظيف سجلّ الحضور ---------------------------------------------------
/**
 * يُنقّي جدول الحضور من نوعَي الفساد المتراكمين:
 *   ١) **صفوفٌ يتيمة**: تخصّ طلاباً حُذفوا (تبقى بعد حذفٍ مباشر أو ترحيلٍ قديم).
 *   ٢) **صفوفٌ مكرّرة**: للطالب نفسه في اليوم نفسه — يُبقى **الأحدث** ويُحذف ما قبله.
 * تعمل داخل معاملةٍ جاهزة (تُنادى من ترقيّة Dexie)، ولها غلافٌ عامّ بالأسفل.
 */
export async function pruneAttendanceTx(tx: {
  table: (name: string) => {
    toArray: () => Promise<unknown[]>;
    bulkDelete: (keys: number[]) => Promise<unknown>;
  };
}): Promise<{ orphans: number; dupes: number }> {
  const rows = (await tx.table('attendance').toArray()) as Attendance[];
  const ids = new Set(
    ((await tx.table('students').toArray()) as Student[])
      .map((s) => s.id)
      .filter((x): x is number => x !== undefined),
  );
  const newest = new Map<string, number>();
  const drop: number[] = [];
  let orphans = 0;
  for (const r of rows) {
    if (r.id === undefined) continue;
    if (!ids.has(r.studentId)) {
      drop.push(r.id);
      orphans += 1;
      continue;
    }
    const key = `${r.studentId}|${r.date}`;
    const prev = newest.get(key);
    if (prev === undefined) newest.set(key, r.id);
    else if (r.id > prev) {
      drop.push(prev); // الأقدم يُحذف
      newest.set(key, r.id);
    } else drop.push(r.id);
  }
  if (drop.length) await tx.table('attendance').bulkDelete(drop);
  return { orphans, dupes: drop.length - orphans };
}

/** فحصٌ عامّ للتنظيف — يُنادى عند فتح نافذة النسخ الاحتياطيّة مثلاً. */
export async function pruneAttendance(): Promise<{ orphans: number; dupes: number }> {
  return db.transaction('rw', db.attendance, db.student, async (tx) =>
    pruneAttendanceTx(tx as never),
  );
}

// ---- الحضور اليومي (جدول attendance) ------------------------------------
// حضورٌ لكل (طالب × تاريخ) ⇒ يسمح بالمراجعة والتعديل بأثر رجعي.

const todayKey = () => isoDay();

/** حضور يوم محدّد لكل الطلاب المطلوبين (studentId → status). */
export async function getAttendance(
  date: string,
  studentIds: number[],
): Promise<Record<number, StudentStatus>> {
  const out: Record<number, StudentStatus> = {};
  if (!studentIds.length) return out;
  const rows = await db.attendance.where('date').equals(date).toArray();
  for (const r of rows) if (studentIds.includes(r.studentId)) out[r.studentId] = r.status;
  return out;
}

/** تثبيت حضور طالب في يوم محدّد (insert or update). */
export async function setAttendance(
  studentId: number | undefined,
  date: string,
  status: StudentStatus | null,
): Promise<void> {
  if (studentId === undefined) return;
  // الإلغاء (الضغط على الحالة المختارة) ⇒ يُمحى صفُّ الحضور ويعود الطالب
  // «غير مُعلَّم» — فالمعلّم يتراجع عن ضغطةٍ خاطئة فوراً.
  if (status === null) {
    await db.attendance.where('[studentId+date]').equals([studentId, date]).delete();
    if (date === todayKey()) {
      await db.student.update(studentId, {
        status: 'not_prepared',
        lastUpdated: new Date(),
      });
    }
    return;
  }
  const existing = await db.attendance
    .where('[studentId+date]')
    .equals([studentId, date])
    .first();
  if (existing?.id !== undefined) {
    await db.attendance.update(existing.id, { status, updatedAt: new Date() });
  } else {
    try {
      await db.attendance.add({
        studentId,
        date,
        status,
        updatedAt: new Date(),
      } as Attendance);
    } catch (e) {
      // ضغطتان سريعتان: القيد الفريد &[studentId+date] منع الثانية ⇒ نُحدّث
      // الصفّ الذي سبقها بدل أن نُضيف صفّاً ثانياً (upsert ذرّي).
      const raced = await db.attendance
        .where('[studentId+date]')
        .equals([studentId, date])
        .first();
      if (raced?.id === undefined) throw e;
      await db.attendance.update(raced.id, { status, updatedAt: new Date() });
    }
  }
  // نُبقي حقل الطالب محدّثاً لتواريخ اليوم (بقية الشاشات تقرأ منه)
  if (date === todayKey()) {
    await db.student.update(studentId, { status, lastUpdated: new Date() });
  }
}

// ---- «لم يحفظ» / نتيجة اليوم -------------------------------------------
// One session row per student per day: marking the result twice UPDATES that
// row instead of piling up duplicates, so the history stays clean.

/** جلسة يوم محدّد لطالب (أو null). */
export async function getDaySession(
  studentId: number,
  date: string = todayKey(),
): Promise<Session | null> {
  const rows = await db.session.where('studentId').equals(studentId).toArray();
  return rows.find((r) => isoDay(new Date(r.date)) === date) ?? null;
}

export const getTodaySession = (studentId: number): Promise<Session | null> =>
  getDaySession(studentId);

/** افتح جلسة اليوم المطلوب (أو أنشئها) وسجّل نتيجتها. */
async function upsertDaySession(
  studentId: number,
  date: string,
  patch: Partial<Omit<Session, 'id' | 'studentId' | 'date'>>,
): Promise<void> {
  const existing = await getDaySession(studentId, date);
  if (existing?.id !== undefined) {
    await db.session.update(existing.id, patch);
    return;
  }
  await db.session.add({
    studentId,
    date: new Date(`${date}T12:00:00`),
    hifzLines: 0,
    murajaahPages: 0,
    score: 0,
    createdAt: new Date(),
    ...patch,
  } as Session);
}

/** سجّل «لم يحفظ» لمادّة محدّدة (حفظ/مراجعة) في يوم محدّد. */
export async function markNotMemorized(
  studentId: number,
  date: string,
  mode: 'hifz' | 'murajaah' = 'hifz',
  note = 'لم يحفظ',
): Promise<void> {
  const modeFields =
    mode === 'hifz'
      ? { hifzResult: 'not_recited' as DailyResult, hifzLines: 0 }
      : { murajaahResult: 'not_recited' as DailyResult, murajaahPages: 0 };
  await upsertDaySession(studentId, date, {
    result: 'not_recited',
    score: 0,
    notes: note,
    ...modeFields,
  });
}

export const markNotMemorizedToday = (studentId: number, note = 'لم يحفظ'): Promise<void> =>
  markNotMemorized(studentId, todayKey(), 'hifz', note);

/**
 * «لم يحفظ» للمادّتين معاً (حفظ + مراجعة) — وهذا معنى زر البطاقة في لوحة الحلقة:
 * الطالب لم يُحضّر شيئاً من منهج اليوم، فلا حفظٌ ولا مراجعة.
 */
export async function markNotMemorizedAll(
  studentId: number,
  date: string,
  note = 'لم يحفظ',
): Promise<void> {
  await upsertDaySession(studentId, date, {
    result: 'not_recited' as DailyResult,
    score: 0,
    notes: note,
    hifzResult: 'not_recited' as DailyResult,
    hifzLines: 0,
    hifzScore: undefined,
    murajaahResult: 'not_recited' as DailyResult,
    murajaahPages: 0,
    murajaahScore: undefined,
  });
  // «لم يحفظ» تسجيلُ تقييمٍ لليوم ⇒ الطالب حاضرٌ (كان غائباً فلن يُسمع له).
  await markPresent(studentId, date);
}

/** تراجع عن «لم يحفظ» للمادّتين (ويحذف صفّ اليوم إن لم يبقَ فيه شيء). */
export async function clearNotMemorizedAll(studentId: number, date: string): Promise<void> {
  const existing = await getDaySession(studentId, date);
  if (existing?.id === undefined) return;
  // لا مقدار مُنجَز في الصفّ ⇒ لا معنى لبقائه بعد رفع العلَمين
  const empty = (existing.hifzLines ?? 0) === 0 && (existing.murajaahPages ?? 0) === 0;
  if (empty) {
    await db.session.delete(existing.id);
    return;
  }
  await db.session.update(existing.id, {
    hifzResult: undefined,
    hifzScore: undefined,
    murajaahResult: undefined,
    murajaahScore: undefined,
    result: undefined,
  });
}

/**
 * تسجيل جزءٍ واحد من التسميع (حفظ أو مراجعة) بنتيجته في صفّ اليوم نفسه.
 * نقطةٌ واحدة يمرّ منها كل تسليم — الورقة والمصحف معاً — فلا تتكرّر الصفوف
 * ولا تُكتب حقول الوضع الآخر.
 */
export async function saveRecitationPart(
  studentId: number,
  date: string,
  mode: 'hifz' | 'murajaah',
  data: {
    amount: number;
    score: number;
    note: string;
    /** المقطع الفعلي الذي سُمِع — مرساة إعادة الجدولة (اختياري للصفوف القديمة) */
    from?: { surah: number; ayah: number };
    to?: { surah: number; ayah: number };
  },
): Promise<void> {
  const modeFields =
    mode === 'hifz'
      ? {
          hifzLines: data.amount,
          hifzResult: 'recited' as DailyResult,
          hifzScore: data.score,
          hifzFrom: data.from,
          hifzTo: data.to,
        }
      : {
          murajaahPages: data.amount,
          murajaahResult: 'recited' as DailyResult,
          murajaahScore: data.score,
          murajaahFrom: data.from,
          murajaahTo: data.to,
        };
  await upsertDaySession(studentId, date, {
    ...modeFields,
    score: data.score,
    notes: data.note,
    result: 'recited' as DailyResult,
  });
  // القاعدة ٤: أيُّ تسميعٍ (حفظ/مراجعة) يثبّت «حاضر» تلقائياً ويقفل الغياب
  // والاستئذان — تُكتب في البيانات فهي مصدر الحقيقة لا العرض.
  await markPresent(studentId, date);
}

/**
 * تثبيت «حاضر» تلقائياً (بلا كتابةٍ زائدة إن كان حاضراً).
 * يستدعيه كل مسار تسجيلٍ للتسميع، فتبقى القاعدة صحيحة أيّاً كان مصدر التسجيل.
 */
export async function markPresent(studentId: number | undefined, date: string): Promise<void> {
  if (studentId === undefined) return;
  const existing = await db.attendance
    .where('[studentId+date]')
    .equals([studentId, date])
    .first();
  if (existing?.status === 'present') return;
  await setAttendance(studentId, date, 'present');
}

/** تراجع عن «لم يحفظ» لمادّة محدّدة (ويحذف صفّ اليوم إن لم يبقَ شيء). */
export async function clearNotMemorized(
  studentId: number,
  date: string,
  mode: 'hifz' | 'murajaah' = 'hifz',
): Promise<void> {
  const existing = await getDaySession(studentId, date);
  if (existing?.id === undefined) return;
  const other = mode === 'hifz' ? existing.murajaahResult : existing.hifzResult;
  const bothGone = !other && (existing.hifzLines ?? 0) === 0 && (existing.murajaahPages ?? 0) === 0;
  if (bothGone) {
    await db.session.delete(existing.id);
    return;
  }
  await db.session.update(
    existing.id,
    mode === 'hifz'
      ? { hifzResult: undefined, hifzScore: undefined }
      : { murajaahResult: undefined, murajaahScore: undefined },
  );
}

export const clearNotMemorizedToday = (studentId: number): Promise<void> =>
  clearNotMemorized(studentId, todayKey(), 'hifz');

/** جلسةُ يوم محدّد لكل طالب (studentId → Session) — لشارات الإنجاز. */
export async function getDaySessions(
  date: string,
  studentIds: number[],
): Promise<Record<number, Session>> {
  const out: Record<number, Session> = {};
  if (!studentIds.length) return out;
  const rows = await db.session.where('studentId').anyOf(studentIds).toArray();
  for (const r of rows) {
    if (isoDay(new Date(r.date)) === date) out[r.studentId] = r;
  }
  return out;
}

/** نتيجةُ يوم محدّد لكل طالب (لتعكسها البطاقات). */
export async function getDayResults(
  date: string,
  studentIds: number[],
): Promise<Record<number, DailyResult>> {
  const out: Record<number, DailyResult> = {};
  if (!studentIds.length) return out;
  const rows = await db.session.where('studentId').anyOf(studentIds).toArray();
  for (const r of rows) {
    if (r.result && isoDay(new Date(r.date)) === date) out[r.studentId] = r.result;
  }
  return out;
}

export const getTodayResults = (studentIds: number[]): Promise<Record<number, DailyResult>> =>
  getDayResults(todayKey(), studentIds);

// ---- ⏸ إيقاف الحفظ مؤقتاً: العدّاد ينقص يوماً لكل «يوم حلقة» -------------

/** activeDays مرتّبة [السبت، الأحد، …، الجمعة] — نحوّل يوم JS إليها. */
function isCircleDay(d: Date, activeDays: boolean[]): boolean {
  const idx = (d.getDay() + 1) % 7; // 0=السبت … 6=الجمعة
  return !!activeDays[idx];
}

/** عدد أيام الحلقة بعد تاريخ البداية وحتى اليوم (شاملاً اليوم). */
function circleDaysBetween(fromISO: string, to: Date, activeDays: boolean[]): number {
  const from = new Date(`${fromISO}T00:00:00`);
  if (Number.isNaN(from.getTime())) return 0;
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  let n = 0;
  const cur = new Date(from);
  cur.setDate(cur.getDate() + 1); // من الغد
  while (cur <= end) {
    if (isCircleDay(cur, activeDays)) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/**
 * ينقص عدّاد الإيقاف يوماً لكل يوم حلقة انقضى، ويُنهي الإيقاف عند الصفر.
 * يُشغَّل مرة عند فتح اللوحة. يعيد عدد الطلاب الذين تغيّر عدّادهم.
 */
export async function tickPauseCountdowns(
  students: Student[],
  activeDays: boolean[],
): Promise<number> {
  const today = new Date();
  const todayISO = isoDay(today);
  let changed = 0;
  for (const s of students) {
    if (!s.hifzPaused || s.id === undefined) continue;
    if (s.hifzPauseStartedOn === todayISO) continue; // احتُسب اليوم بالفعل
    const elapsed = s.hifzPauseStartedOn
      ? circleDaysBetween(s.hifzPauseStartedOn, today, activeDays)
      : 0;
    const left = Math.max(0, (s.hifzPauseDays ?? 0) - elapsed);
    await db.student.update(s.id, {
      hifzPauseDays: left,
      hifzPauseStartedOn: todayISO,
      hifzPaused: left > 0, // انتهى الإيقاف ⇒ يعود الحفظ تلقائياً
      lastUpdated: new Date(),
    });
    changed += 1;
  }
  return changed;
}

// Upsert ring, persisted to Dexie, returns id
export async function persistRing(ring: Ring): Promise<number> {
  const id = await db.ring.add(ring);
  return id as number;
}

// ---- إدارة الحلقات (تعديل / حذف) ----------------------------------------

/** حقول الحلقة القابلة للتعديل — نقطةٌ واحدة يمرّ منها الحفظ فلا سجلّ ناقص. */
export type RingEditableFields = Pick<
  Ring,
  'name' | 'period' | 'weekStartDay' | 'activeDays' | 'allowOffDayRecitation'
>;

/** يحدّث بيانات الحلقة ويُعيدها محدَّثة. */
export async function persistRingEdit(
  id: number | undefined,
  patch: RingEditableFields,
): Promise<Ring | undefined> {
  if (id === undefined) return undefined;
  await db.ring.update(id, patch);
  return db.ring.get(id);
}

/**
 * حذف حلقة **بكل ما يتعلّق بها** في معاملةٍ واحدة:
 *   طلابُها ⇒ جلساتهم + سجلّات حضورهم ⇒ الطلاب ⇒ الحلقة.
 * المعاملة تضمن ألّا يبقى صفٌّ يتيم (لا جلسةٌ لطالبٍ محذوف ولا طالبٌ لحلقةٍ محذوفة).
 * تُعيد عدد الطلاب المحذوفين.
 */
export async function deleteRingCascade(ringId: number | undefined): Promise<number> {
  if (ringId === undefined) return 0;
  let removed = 0;
  await db.transaction('rw', db.ring, db.student, db.session, db.attendance, async () => {
    const students = await db.student.where('ringId').equals(ringId).toArray();
    const ids = students
      .map((s) => s.id)
      .filter((x): x is number => typeof x === 'number');
    if (ids.length) {
      await db.session.where('studentId').anyOf(ids).delete();
      await db.attendance.where('studentId').anyOf(ids).delete();
      await db.student.bulkDelete(ids);
      removed = ids.length;
    }
    await db.ring.delete(ringId);
  });
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// أيام العمل + قواعد نهاية اليوم
// ─────────────────────────────────────────────────────────────────────────────

// دوالّ أيام الحلقة تعيش في utils/ringDays (مصدرٌ واحد يشاركه المحرّك واللوحة)
// وتُستورد هنا للاستعمال الداخلي وتُعاد تصديرها لمسارات الاستيراد القائمة.
export { dayIndexOf, isWorkDay, recitationAllowed, DAY_NAMES, addDays, daysBetween, weekStartOf, workDaysBetween } from '../utils/ringDays';

/**
 * **قواعد نهاية اليوم** — تُستدعى عند فتح اللوحة أو تغيير التاريخ:
 *   ① يومُ عملٍ مضى، وطالبٌ لا حضورَ له ولا تسميع ⇒ يُثبَّت **غائب**.
 *   ② يومُ عملٍ مضى، وحضورُه **حاضر** أو **متأخر** بلا أيّ تسميع ⇒ **لم يحفظ**
 *      (مع بقاء حضوره كما هو — لا نمسّ «متأخر»).
 * أيام الإجازة لا تُمسّ إطلاقاً، واليوم الجاري لا يُحكَم عليه لأنه لم ينتهِ.
 * تُعيد عدد الصفوف التي صُحّحت (تُستعمل في التقرير والتحقّق).
 */
export async function finalizePastDays(
  ring: Ring,
  today: string = isoDay(),
  daysBack = 21,
): Promise<number> {
  if (ring.id === undefined) return 0;
  const students = await db.student.where('ringId').equals(ring.id).toArray();
  const ids = students.map((s) => s.id).filter((x): x is number => x !== undefined);
  if (!ids.length) return 0;

  // أيام العمل الماضية فقط — الإجازة خارج الحساب
  const days: string[] = [];
  const base = new Date(`${today}T00:00:00`);
  for (let k = 1; k <= daysBack; k += 1) {
    const d = new Date(base);
    d.setDate(d.getDate() - k);
    const key = isoDay(d);
    if (isWorkDay(ring, key)) days.push(key);
  }
  if (!days.length) return 0;

  // قراءتان مجمّعتان لكل المدى — لا استعلامٌ لكل طالبٍ في كل يوم
  const from = days[days.length - 1];
  const [attRows, sesRows] = await Promise.all([
    db.attendance.where('date').between(from, today, true, false).toArray(),
    db.session.where('studentId').anyOf(ids).toArray(),
  ]);
  const attMap = new Map<string, StudentStatus>();
  for (const r of attRows) attMap.set(`${r.studentId}|${r.date}`, r.status);
  const sesSet = new Set<string>();
  for (const r of sesRows) sesSet.add(`${r.studentId}|${isoDay(new Date(r.date))}`);

  let fixed = 0;
  for (const date of days) {
    for (const sid of ids) {
      const key = `${sid}|${date}`;
      if (sesSet.has(key)) continue; // سُجّل له تسميعٌ ⇒ لا حكم
      const status = attMap.get(key);
      if (status === undefined) {
        await setAttendance(sid, date, 'absent'); // ① لا حضور ولا تسميع
        fixed += 1;
      } else if (status === 'present' || status === 'late') {
        // ② حضر ولم يسمّع ⇒ «لم يحفظ» — بلا مسّ صفّ الحضور
        await upsertDaySession(sid, date, {
          result: 'not_recited' as DailyResult,
          score: 0,
          notes: 'لم يحفظ',
          hifzResult: 'not_recited' as DailyResult,
          hifzLines: 0,
          hifzScore: undefined,
          murajaahResult: 'not_recited' as DailyResult,
          murajaahPages: 0,
          murajaahScore: undefined,
        });
        fixed += 1;
      }
    }
  }
  return fixed;
}
