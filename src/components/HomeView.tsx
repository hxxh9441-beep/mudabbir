// src/components/HomeView.tsx
import { useState, useEffect, useCallback } from 'react';
import { BookOpen, ChevronLeft, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DatabaseBackup } from 'lucide-react';
import BackupModal from './BackupModal';
import AppBackground from './AppBackground';
import ErrorBoundary from './ErrorBoundary';
import ThemeToggle from './ThemeToggle';
import RingCard from './RingCard';
import AddRingModal from './AddRingModal';
import EditRingModal from './EditRingModal';
import CircleDashboard from './CircleDashboard';
import MushafView from './MushafView';
import StudentPlanPage from './StudentPlanPage';
import MushafReader from './MushafReader';
import { db } from '../db';
import type { Ring } from '../db/schema';
import {
  parseRoute,
  currentHash,
  homeHash,
  circleHash,
  recitationHash,
  readerHash,
  navigate,
} from '../utils/nav';

// Seed rings used the first time the app runs (empty Dexie)


export default function HomeView() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  /** الحلقة الجاري تعديلها (null = لا نافذة تعديل) */
  const [editingRing, setEditingRing] = useState<Ring | null>(null);
  // Navigation state restored from the URL hash (survives refresh).
  const [selectedRing, setSelectedRing] = useState<Ring | null>(null);
  const [recitationStudentId, setRecitationStudentId] = useState<number | null>(null);
  const [mushafStudentId, setMushafStudentId] = useState<number | null>(null);
  const [planStudentId, setPlanStudentId] = useState<number | null>(null);
  /** «المصحف الكامل»: قارئٌ مستقلّ لا يتبع حلقةً ولا طالباً */
  const [readerOpen, setReaderOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [readerPage, setReaderPage] = useState<number | undefined>(undefined);

  
  // Live query (readonly): rings sorted by id.
  // NOTE: no default value — `undefined` means "not resolved yet", so the
  // route-restore effect waits for the real data instead of resetting a
  // deep link (#/circle/…) to home during a cold page load.
  const rings = useLiveQuery(async () => {
    const rows = await db.ring.toArray();
    return rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }, []);

  // Resolve the current hash into {ring, recitationStudentId} and apply it.
  const applyRoute = useCallback(
    async (ringList: Ring[]) => {
      const route = parseRoute(currentHash());
      if (route.view === 'home') {
        setSelectedRing(null);
        setRecitationStudentId(null);
        setMushafStudentId(null);
        setPlanStudentId(null);
        setReaderOpen(false);
        return;
      }
      if (route.view === 'reader') {
        setSelectedRing(null);
        setRecitationStudentId(null);
        setMushafStudentId(null);
        setPlanStudentId(null);
        setReaderPage(route.page);
        setReaderOpen(true);
        return;
      }
      const ring = ringList.find((r) => r.id === route.ringId) ?? null;
      if (!ring) {
        // Ring id not found (e.g. hash from a deleted ring) → go home
        navigate(homeHash());
        setSelectedRing(null);
        setRecitationStudentId(null);
        setMushafStudentId(null);
        setPlanStudentId(null);
        setReaderOpen(false);
        return;
      }
      setReaderOpen(false);
      setSelectedRing(ring);
      if (route.view === 'plan') {
        setPlanStudentId(route.studentId);
        setMushafStudentId(null);
        setRecitationStudentId(null);
      } else if (route.view === 'mushaf') {
        setMushafStudentId(route.studentId);
        setPlanStudentId(null);
        setRecitationStudentId(null);
      } else {
        setPlanStudentId(null);
        setRecitationStudentId(route.recitationStudentId ?? null);
        setMushafStudentId(null);
      }
    },
    [],
  );

  // Re-apply the route whenever the rings list loads/changes.
  useEffect(() => {
    if (!rings) return; // wait for first live-query resolution
    void applyRoute(rings);
  }, [rings, applyRoute]);

  // Listen to hash changes (back/forward buttons, manual edits).
  useEffect(() => {
    const onHash = () => {
      if (!rings) return;
      void applyRoute(rings);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [rings, applyRoute]);

  const addRing = async (ring: Omit<Ring, 'id'>) => {
    await db.ring.add(ring);
    setIsModalOpen(false);
  };

  const openCircle = (ring: Ring) => {
    navigate(circleHash(ring.id!));
    setSelectedRing(ring);
    setRecitationStudentId(null);
  };

  const openReader = () => {
    navigate(readerHash());
    setReaderPage(undefined);
    setReaderOpen(true);
  };

  return (
    <div className="app-bg relative min-h-screen overflow-hidden transition-colors duration-500">
      {/* Decorative warm gradient blobs */}
      <AppBackground />

      <div className="relative mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
        {/* iOS-style Navigation bar */}
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#2D1F17] dark:text-[#F5EBE1] sm:text-4xl">
              مُدَبِّر
            </h1>
            <p className="mt-1 text-xs font-semibold tracking-wide text-[#8a7261]/90 dark:text-amber-100/50 sm:text-sm">
              مساعد إدارة الحلقة الأمثل
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setBackupOpen(true)}
              aria-label="نسخة احتياطية"
              title="نسخة احتياطية — تنزيل بيانات الجهاز أو استعادتها من ملفّ"
              className="press flex h-11 w-11 items-center justify-center rounded-full border border-amber-900/10 bg-amber-50/80 text-[#B8860B] shadow-sm backdrop-blur-xl transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-[#241A14]/70 dark:text-amber-300 dark:hover:bg-[#2f2118]"
            >
              <DatabaseBackup className="h-5 w-5" />
            </button>
            <ThemeToggle />
            <button
              onClick={() => setIsModalOpen(true)}
              aria-label="إضافة حلقة"
              className="press flex h-11 w-11 items-center justify-center rounded-full border border-amber-900/10 bg-amber-50/80 text-[#B8860B] shadow-sm backdrop-blur-xl transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-[#241A14]/70 dark:text-amber-300 dark:hover:bg-[#2f2118]"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
        </header>

        {/* ===== فاصلٌ رقيق ثم عنوان القسم (مع عدد الحلقات) ===== */}
        <div className="mb-5 flex items-center justify-between gap-3 border-t border-black/[0.07] pt-4 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-[13px] font-bold text-[#6b5a4a] dark:text-amber-100/60">
            اختر حلقة لبدء التسميع
            {rings ? (
              <span
                data-ring-count="1"
                className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-extrabold text-[#8a7261] dark:bg-white/10 dark:text-amber-100/70"
              >
                ({String(rings.length).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d])})
              </span>
            ) : null}
          </h2>
        </div>

        {/* Rings grid */}
        {!rings ? (
          <p className="py-10 text-center text-[#6b5a4a] dark:text-amber-100/50">جارٍ التحميل…</p>
        ) : rings.length === 0 ? (
          <div className="glass p-10 text-center">
            <p className="text-lg font-semibold text-[#4a3a2c] dark:text-amber-50">
              لا توجد حلقات بعد
            </p>
            <p className="mt-1 text-sm text-[#6b5a4a] dark:text-amber-100/60">
              أضف أول حلقة للبدء 🌱
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rings.map((ring) => (
              <RingCard
                key={ring.id}
                ring={ring}
                onClick={() => openCircle(ring)}
                onEdit={() => setEditingRing(ring)}
              />
            ))}
          </div>
        )}

        {/* ===== «المصحف الكامل» — بطاقةُ تنقّلٍ تحت قائمة الحلقات ===== */}
        <button
          onClick={openReader}
          aria-label="فتح المصحف الكامل"
          className="glass press group mt-5 flex w-full items-center gap-4 p-4 text-right transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8860B]/60"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100/80 text-[#B8860B] ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25">
            <BookOpen className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-extrabold leading-tight text-[#2D1F17] dark:text-[#F5EBE1]">
              المصحف
            </span>
            <span className="mt-0.5 block text-sm font-semibold text-[#6b5a4a] dark:text-amber-100/60">
              فتح المصحف
            </span>
          </span>
          <ChevronLeft className="h-6 w-6 shrink-0 text-[#B8860B] transition-transform duration-200 group-hover:-translate-x-1 dark:text-amber-300" />
        </button>
      </div>

      <AddRingModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onAdd={addRing} />
      {/* ===== تعديل بيانات الحلقة / حذفها ===== */}
      <EditRingModal
        isOpen={editingRing !== null}
        ring={editingRing}
        onClose={() => setEditingRing(null)}
        onSaved={() => {
          // القائمة حيّة (useLiveQuery) ⇒ تتحدّث فوراً بعد الحفظ.
          setEditingRing(null);
        }}
        onDeleted={() => {
          // لو كان الرابط يشير إلى الحلقة المحذوفة نعود للرئيسية.
          if (parseRoute(currentHash()).view !== 'home') navigate(homeHash());
          setEditingRing(null);
        }}
      />
      {/* ===== المصحف الكامل (قارئٌ مستقلّ) ===== */}
      {readerOpen && (
        <MushafReader
          initialPage={readerPage}
          onBack={() => {
            navigate(homeHash());
            setReaderOpen(false);
          }}
        />
      )}
      {selectedRing && (
        <ErrorBoundary label="صفحة الحلقة" onBack={() => { navigate(homeHash()); setSelectedRing(null); }}>
        <CircleDashboard
          ring={selectedRing}
          initialRecitationStudentId={recitationStudentId}
          onClose={() => {
            navigate(homeHash());
            setSelectedRing(null);
            setRecitationStudentId(null);
            setMushafStudentId(null);
            setPlanStudentId(null);
          }}
        />
        </ErrorBoundary>
      )}
      {/* النسخ الاحتياطي والاستعادة — ينفّذهما db/backup عبر dexie-export-import */}
      <BackupModal isOpen={backupOpen} onClose={() => setBackupOpen(false)} />

      {/* Dedicated full-screen Student-Plan route (renders above the circle) */}
      {selectedRing && planStudentId != null && (
        <ErrorBoundary label="خطة الطالب" onBack={() => navigate(circleHash(selectedRing.id!))}>
        <StudentPlanPage
          ringId={selectedRing.id!}
          studentId={planStudentId}
          onBack={() => navigate(circleHash(selectedRing.id!))}
        />
        </ErrorBoundary>
      )}
      {/* Dedicated full-screen Mushaf route (renders above the circle) */}
      {selectedRing && mushafStudentId != null && (
        <MushafView
          ringId={selectedRing.id!}
          studentId={mushafStudentId}
          onBack={() => navigate(recitationHash(selectedRing.id!, mushafStudentId))}
          onApproved={() => navigate(circleHash(selectedRing.id!))}
        />
      )}
    </div>
  );
}
