// src/components/CircleDashboard.tsx
// Full-page Circle Details screen (NOT a floating modal).
// - Sticky navigation bar keeps the circle header always visible.
// - Student list scrolls naturally without ever clipping the header.
import { useEffect, useState } from 'react';
import { Plus, ArrowRight, UserPlus } from 'lucide-react';
import StudentCard from './StudentCard';
import AddStudentModal from './AddStudentModal';
import EditStudentModal from './EditStudentModal';
import DateBar from './DateBar';
import {
  db,
  markNotMemorizedAll,
  clearNotMemorizedAll,
  finalizePastDays,
  getAttendance,
  isWorkDay,
  recitationAllowed,
  getDaySessions,
  setAttendance,
  isoDay,
  tickPauseCountdowns,
} from '../db';
import type { Student, StudentStatus, Session } from '../db/schema';
import { curriculum, loadCurriculum } from '../utils/progression';
import { dayStatuses, onboardingActive, planFor } from '../utils/dailyPlan';
import AppBackground from './AppBackground';

export default function CircleDashboard({
  ring,
  onClose,
  initialRecitationStudentId,
}: {
  ring: any;
  onClose: () => void;
  initialRecitationStudentId?: number | null;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [autoOpenDone, setAutoOpenDone] = useState(false);
  // the student whose Edit sheet is open (one modal instance for the whole list)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  // جلسة اليوم لكل طالب (لم يحفظ / تم الحفظ / تمت المراجعة) — للتاريخ المختار
  const [daySessions, setDaySessions] = useState<Record<number, Session>>({});
  // حضور اليوم المختار لكل طالب (جدول attendance)
  const [attendanceMap, setAttendanceMap] = useState<Record<number, StudentStatus>>({});
  // التاريخ المختار في شريط التاريخ (افتراضياً اليوم)
  const [selectedDate, setSelectedDate] = useState<string>(() => isoDay());
  // فهرس المنهج جاهز ⇒ تُحسب مهمّة اليوم في البطاقات
  const [ready, setReady] = useState(false);

  // When restoring from a saved hash that points at a recitation, remember
  // which student card should auto-open its RecitationSheet once loaded.
  const autoStudentId =
    !autoOpenDone && initialRecitationStudentId != null ? initialRecitationStudentId : null;

  // تحميل طلاب الحلقة من Dexie — **بلا أيّ زرع**: الحلقة الجديدة تبدأ فارغةً
  // تماماً (كان هنا زرعُ طالبين وهميّين لكل حلقةٍ فارغة — أُزيل نهائياً).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let rows = await db.student.where('ringId').equals(ring.id).toArray();
        // ⏸ إيقاف الحفظ: ينقص العدّاد يوماً لكل «يوم حلقة» — مرة عند فتح اللوحة
        const ticked = await tickPauseCountdowns(rows as Student[], ring.activeDays);
        if (ticked > 0) {
          rows = (await db.student.where('ringId').equals(ring.id).toArray()) as Student[];
        }
        if (!cancelled) setStudents(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ring.id, ring.activeDays]);

  // الحضور يُكتب في جدول attendance للتاريخ المختار (لا على سجل الطالب).
  // والإلغاء (null) يمحو صفّ اليوم فيعود الطالب «غير مُعلَّم».
  const updateStudentStatus = (id: number | undefined, status: StudentStatus | null) => {
    if (id === undefined) return;
    setAttendanceMap((prev) => {
      const next = { ...prev };
      if (status === null) delete next[id];
      else next[id] = status;
      return next;
    });
    void setAttendance(id, selectedDate, status);
  };

  // The Edit modal performs the actual deletion itself (student + his sessions,
  // in one Dexie transaction) and then asks us to drop him from the list.
  const removeStudentLocally = (id: number | undefined) => {
    if (id === undefined) return;
    setStudents((prev) => prev.filter((s) => s.id !== id));
  };

  const refreshStudents = async () => {
    const rows = await db.student.where('ringId').equals(ring.id).toArray();
    setStudents(rows);
    setLoading(false);
  };

  // فهرس المنهج (~17KB) — لازمة لحساب مهمّة اليوم في البطاقات.
  // إعادةُ محاولةٍ عند الفشل: كان التحميل محاولةً واحدة، فإن تعثّر (شبكة/HMR)
  // ظلّت البطاقات بلا خطّة إلى الأبد بصمت. الآن نُعيد المحاولة بتراجعٍ قصير.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = (attempt: number) => {
      loadCurriculum()
        .then(() => {
          if (alive) setReady(true);
        })
        .catch(() => {
          if (alive && attempt < 5) {
            timer = window.setTimeout(() => load(attempt + 1), 300 * (attempt + 1));
          }
        });
    };
    load(0);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // **قواعد نهاية اليوم** — تُشغَّل عند فتح اللوحة وعند كل تغيير تاريخ:
  // الأيام الماضية (أيام العمل فقط) تُحسم: بلا حضورٍ ولا تسميع ⇒ غائب،
  // وحاضر/متأخر بلا تسميع ⇒ لم يحفظ. ثم نُعيد قراءة ما تغيّر.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fixed = await finalizePastDays(ring, isoDay());
        if (alive && fixed > 0) await refreshStudents();
      } catch {
        /* الحسم تحسينٌ لا شرط — لا نُعطّل اللوحة إن فشل */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring.id, ring.activeDays, selectedDate]);

  // بيانات اليوم المختار (حضور + نتيجة) — تُعاد القراءة عند تغيير التاريخ
  // أو تغيّر قائمة الطلاب، فيبقى كل شيء مفتاحه التاريخ المختار.
  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = students.map((s) => s.id).filter((x): x is number => x !== undefined);
      const [att, ses] = await Promise.all([
        getAttendance(selectedDate, ids),
        getDaySessions(selectedDate, ids),
      ]);
      if (!alive) return;
      setAttendanceMap(att);
      setDaySessions(ses);
    })();
    return () => {
      alive = false;
    };
  }, [selectedDate, students]);

  // «لم يحفظ» من البطاقة = الطالب لم يُحضّر منهج اليوم إطلاقاً ⇒ تُعلَّم المادّتان
  // معاً (حفظ ⛔ + مراجعة ⛔). والضغطة الثانية تتراجع عنهما معاً.
  const toggleNotMemorized = async (student: Student) => {
    const id = student.id;
    if (id === undefined) return;
    const st = dayStatuses(daySessions[id]);
    if (st.hifz === 'not_recited' && st.murajaah === 'not_recited')
      await clearNotMemorizedAll(id, selectedDate);
    else await markNotMemorizedAll(id, selectedDate);
    await refreshStudents();
  };

  // حضور البطاقة = حضور التاريخ المختار. وإن لم يكن مسجّلاً:
  //  • تاريخ اليوم ⇒ نرجع لحالة الطالب المحفوظة (توافقاً مع البيانات القديمة)
  //  • تاريخ ماضٍ ⇒ «لم يُحضّر» فلا يظهر أي زر محدّد (لا نُقحم حضور اليوم فيه)
  const dayStatusOf = (s: Student): StudentStatus | null => {
    const rec = s.id !== undefined ? attendanceMap[s.id] : undefined;
    if (rec) return rec;
    if (selectedDate !== isoDay()) return null; // تاريخٌ مضى بلا سجلّ ⇒ غير مُعلَّم
    return s.status === 'not_prepared' ? null : s.status;
  };
  /**
   * عدّاد الحضور: «حاضر» + **«متأخر»** — فالمتأخر حاضرٌ جسَداً في الحلقة،
   * وإنما تأخّر. غيابُه من العدّ كان يجعل الترويسة تقول «٠ حاضر» وفي الحلقة طالب.
   */
  const presentCount = students.filter((s) => {
    const st = dayStatusOf(s);
    return st === 'present' || st === 'late';
  }).length;

  return (
    <div className="app-bg fixed inset-0 z-40 flex flex-col">
      {/* خلفيّة مُدَبِّر الموحَّدة — نفس دفء الشاشة الرئيسيّة بالضبط */}
      <AppBackground />
      {/* ---- Sticky Navigation Bar (always visible) ----
          يتبع الثيم: خلفية ورقية دافئة في النهاري، وموكا داكن في الليلي —
          فلا يبقى الشريط أسود والنصّ فيه بنّي غامق (كان غير مقروء). */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-black/[0.06] bg-white/20 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-black/20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          {/* Right: Back button */}
          <button
            onClick={onClose}
            aria-label="رجوع"
            className="press flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-3 py-2 text-sm font-bold text-[#5A4636] hover:bg-black/10 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </button>

          {/* Center: Circle name + attendance for the selected date */}
          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-xl font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
              {ring.name}
            </h2>
            <p className="truncate text-xs font-semibold text-[#5F5044] dark:text-amber-100/70">
              {selectedDate === isoDay() ? 'حضور اليوم' : 'أرشيف'}: {presentCount} حاضر ·{' '}
              {students.length} {students.length === 1 ? 'طالب' : 'طلاب'}
            </p>
          </div>

          {/* Left: Add student */}
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="press flex shrink-0 items-center gap-1.5 rounded-full bg-[#B8860B] px-3.5 py-2 text-sm font-extrabold text-white shadow-lg shadow-amber-700/40 hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            إضافة طالب
          </button>
        </div>

        {/* ── شريط التاريخ: تنقّل سريع + منتقي تاريخ (مراجعة/تعبئة رجعية) ── */}
        <div className="mx-auto mt-3 max-w-lg">
          <DateBar
            value={selectedDate}
            onChange={setSelectedDate}
            today={isoDay()}
            isCircleDay={isWorkDay(ring, selectedDate)}
          />
        </div>
      </header>

      {/* ---- Scrollable Student List ---- */}
      <main className="relative z-10 flex-1 overflow-y-auto pb-24">
        <div className="mx-auto max-w-5xl space-y-4 px-4 pt-4">
          {loading ? (
            <p className="py-10 text-center font-semibold text-[#7a6450] dark:text-amber-100/50">
              جارٍ التحميل…
            </p>
          ) : students.length === 0 ? (
            <div
              data-empty-students="1"
              className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-12 text-center"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#B8860B]/12 text-[#B8860B] dark:bg-amber-400/15 dark:text-amber-300">
                <UserPlus className="h-8 w-8" />
              </span>
              <p className="text-lg font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
                لا يوجد طلاب مضافون في هذه الحلقة بعد
              </p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="press inline-flex items-center gap-2 rounded-2xl bg-[#B8860B] px-5 py-3 text-base font-extrabold text-white shadow-lg shadow-amber-700/30 hover:brightness-110"
              >
                <Plus className="h-5 w-5" />
                إضافة طالب
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {students.map((student) => {
                const dm = dayStatuses(daySessions[student.id ?? -1]);
                // يومُ إجازةٍ بلا إذن ⇒ التسميع مقفل، والخطّة لا تُسنَد (لا تزحف)
                const locked = !recitationAllowed(ring, selectedDate);
                const offDay = !isWorkDay(ring, selectedDate);
                // الحارس: `ready` يُحدث إعادة الرسم، و`curriculum()` فحصٌ فوريٌّ
                // يضمن ظهور الخطّة ما دام الفهرس محمَّلاً — فلا تختفي الخطّة إن
                // تعثّر مؤشّر الحالة لأيّ سبب.
                const plansAllowed = (ready || curriculum() !== null) && !locked;
                return (
                <StudentCard
                  key={student.id}
                  student={student}
                  ringName={ring.name}
                  ringPeriod={ring.period}
                  autoOpenRecitation={autoStudentId === student.id}
                  onRecitationStateChange={(open) => {
                    if (open) setAutoOpenDone(true);
                    // عند انتهاء جلسة التسميع تتغيّر نتيجة اليوم → أعِد القراءة
                    else void refreshStudents();
                  }}
                  onUpdateStatus={(status) => updateStudentStatus(student.id, status)}
                  onEdit={() => setEditingStudent(student)}
                  notMemorizedToday={dm.hifz === 'not_recited' && dm.murajaah === 'not_recited'}
                  onToggleNotMemorized={() => void toggleNotMemorized(student)}
                  dayStatus={dayStatusOf(student)}
                  date={selectedDate}
                  hifzPlan={plansAllowed ? planFor(student, 'hifz') : null}
                  murajaahPlan={plansAllowed ? planFor(student, 'murajaah') : null}
                  dayMarks={dm}
                  recitationLocked={locked}
                  recitationOffDay={offDay}
                  murajaahSuspended={onboardingActive(student)}
                />
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Add student bottom sheet */}
      <AddStudentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        ringId={ring.id}
        onAdded={refreshStudents}
      />

      {/* Edit student sheet — the only place a student (and his records) can be
          deleted, behind an explicit confirmation */}
      <EditStudentModal
        isOpen={editingStudent !== null}
        student={editingStudent}
        onClose={() => setEditingStudent(null)}
        onSaved={refreshStudents}
        onDeleted={() => removeStudentLocally(editingStudent?.id)}
      />
    </div>
  );
}
