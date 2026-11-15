import { beforeAll, describe, expect, it } from 'vitest';
import { loadCurriculum } from '../src/utils/progression';
import { monthBounds, projectMonth, projectWeek } from '../src/utils/planProjection';
import { baqarahStudent, baseStudent, ring, session } from './fixtures';

beforeAll(async () => {
  await loadCurriculum();
});

// ٢٠٢٦-١١-١٤ سبت (إجازة) … الأحد ١٥ إلى الخميس ١٩ أيام عمل، الجمعة ٢٠ إجازة
const WEEK = '2026-11-14';
const TODAY = '2026-11-15';

const week = (student = baqarahStudent(), sessions = [] as ReturnType<typeof session>[], today = TODAY) =>
  projectWeek({ student, ring: ring(), sessions, weekStart: WEEK, today });

describe('الخطة الأسبوعية', () => {
  it('سبعة أيام، وأيام الإجازة بلا مقطع', () => {
    const w = week();
    expect(w.days).toHaveLength(7);
    for (const d of w.days.filter((x) => !x.work)) {
      expect(d.hifz).toBeNull();
      expect(d.murajaah).toBeNull();
    }
    expect(w.days.filter((d) => d.work && d.hifz)).toHaveLength(5);
  });

  it('أيام العمل متسلسلة: بداية كل يومٍ جديد = ما بعد نهاية الذي قبله', () => {
    const w = week();
    const work = w.days.filter((d) => d.hifz);
    for (let i = 1; i < work.length; i++) {
      const prev = work[i - 1].hifz!;
      expect(work[i].hifz!.newFrom).toEqual(prev.nextStart);
    }
  });

  it('الموضع المخزَّن هو بداية أول يوم عمل غير مُسجَّل', () => {
    const s = baqarahStudent({ currentSurah: 2, currentAyah: 40 });
    const first = week(s).days.find((d) => d.hifz)!;
    expect(first.hifz!.newFrom).toEqual({ surah: 2, ayah: 40 });
  });

  it('isToday / isPast تُحسبان من today', () => {
    const w = week(baqarahStudent(), [], '2026-11-17');
    expect(w.days.find((d) => d.date === '2026-11-17')?.isToday).toBe(true);
    expect(w.days.find((d) => d.date === '2026-11-16')?.isPast).toBe(true);
    expect(w.days.find((d) => d.date === '2026-11-18')?.isPast).toBe(false);
  });
});

describe('المرساة الفعلية', () => {
  it('يومٌ مسجَّل يعرض مقطعه الفعلي ويُعلَّم recorded', () => {
    const s = session('2026-11-15', {
      hifzResult: 'recited',
      hifzLines: 4,
      score: 18,
      hifzFrom: { surah: 2, ayah: 1 },
      hifzTo: { surah: 2, ayah: 4 },
    });
    const w = week(baqarahStudent(), [s], '2026-11-16');
    const d = w.days.find((x) => x.date === '2026-11-15')!;
    expect(d.recorded).toBe(true);
    expect(d.hifz?.to).toEqual({ surah: 2, ayah: 4 });
    expect(d.score).toBe(18);
    expect(w.recordedCount).toBe(1);
  });

  it('إن سُمِع أقل من المخطَّط فالغد يبدأ من الآية التالية لما سُمِع فعلاً', () => {
    const s = session('2026-11-15', {
      hifzResult: 'recited',
      hifzLines: 2,
      hifzFrom: { surah: 2, ayah: 1 },
      hifzTo: { surah: 2, ayah: 3 },
    });
    const w = week(baqarahStudent(), [s], '2026-11-16');
    const next = w.days.find((x) => x.date === '2026-11-16')!;
    expect(next.hifz?.newFrom).toEqual({ surah: 2, ayah: 4 });
  });

  it('المقطع الموافق للمخطَّط لا يُعلَّم adjusted', () => {
    const s = session('2026-11-15', {
      hifzResult: 'recited',
      hifzLines: 5,
      hifzFrom: { surah: 2, ayah: 1 },
      hifzTo: { surah: 2, ayah: 2 },
    });
    const d = week(baqarahStudent(), [s], '2026-11-16').days.find((x) => x.date === '2026-11-15')!;
    expect(d.adjusted).toBe(false);
  });

  it('تعديلٌ يدويّ يخالف المخطَّط يُعلَّم adjusted', () => {
    const s = session('2026-11-15', {
      hifzResult: 'recited',
      hifzLines: 1,
      hifzFrom: { surah: 2, ayah: 1 },
      hifzTo: { surah: 2, ayah: 1 }, // المخطَّط ينتهي عند ٢:٢
    });
    const d = week(baqarahStudent(), [s], '2026-11-16').days.find((x) => x.date === '2026-11-15')!;
    expect(d.adjusted).toBe(true);
  });

  it('يومُ إجازةٍ سُجّل فيه تسميعٌ يظهر بما فيه ولا يُكلَّف غيره', () => {
    const s = session('2026-11-14', {
      hifzResult: 'recited',
      hifzLines: 3,
      hifzFrom: { surah: 2, ayah: 1 },
      hifzTo: { surah: 2, ayah: 3 },
    });
    const w = week(baqarahStudent(), [s], '2026-11-15');
    const sat = w.days.find((x) => x.date === '2026-11-14')!;
    expect(sat.work).toBe(false);
    expect(sat.recorded).toBe(true);
    expect(sat.hifz?.to).toEqual({ surah: 2, ayah: 3 });
  });

  it('«لم يحفظ» لا يُعدّ تسميعاً مسجَّلاً', () => {
    const s = session('2026-11-15', { hifzResult: 'not_recited' });
    const d = week(baqarahStudent(), [s], '2026-11-16').days.find((x) => x.date === '2026-11-15')!;
    expect(d.recorded).toBe(false);
  });
});

describe('التأسيس والمراجعة في الإسقاط', () => {
  const fresh = baseStudent({
    hifzStartSurah: 114,
    hifzStartAyah: 1,
    hifzDirection: 'nas-to-baqarah',
    murajaahStartSurah: 114,
    murajaahStartAyah: 1,
    murajaahDirection: 'nas-to-baqarah',
  });

  it('المراجعة موقوفة طوال التأسيس ويُعلَّم murajaahSuspended', () => {
    const w = week(fresh);
    for (const d of w.days.filter((x) => x.hifz)) {
      expect(d.hifz!.kind).toBe('onboarding');
      expect(d.murajaah).toBeNull();
      expect(d.murajaahSuspended).toBe(true);
    }
  });

  it('الكتلة التراكمية تنمو يوماً بعد يوم من الناس ١', () => {
    const days = week(fresh).days.filter((d) => d.hifz);
    expect(days[0].hifz!.from).toEqual({ surah: 114, ayah: 1 });
    expect(days[4].hifz!.from).toEqual({ surah: 114, ayah: 1 });
    expect(days[4].hifz!.pages).toBeGreaterThan(days[0].hifz!.pages);
  });

  it('بعد بلوغ الفجر تعود المراجعة ضمن الشهر نفسه', () => {
    const { from, to } = monthBounds('2026-11');
    const m = projectMonth({
      student: fresh,
      ring: ring(),
      sessions: [],
      month: '2026-11',
      today: from,
    });
    expect(m.weekStart).toBe(from);
    expect(m.weekEnd).toBe(to);
    const kinds = m.days.filter((d) => d.hifz).map((d) => d.hifz!.kind);
    expect(kinds[0]).toBe('onboarding');
    const firstRolling = kinds.indexOf('rolling');
    expect(firstRolling).toBeGreaterThan(0); // التأسيس ينتهي خلال الشهر
    const resumed = m.days.filter((d) => d.hifz?.kind === 'rolling' && d.murajaah);
    expect(resumed.length).toBeGreaterThan(0);
    // ولا مراجعةَ قبل الإغلاق
    const earlyReview = m.days.slice(0, firstRolling).some((d) => d.murajaah);
    expect(earlyReview).toBe(false);
  });
});

describe('الشهر', () => {
  it('monthBounds: أول الشهر وآخره', () => {
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds('2028-02').to).toBe('2028-02-29');
  });
});
