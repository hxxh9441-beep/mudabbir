import { beforeAll, describe, expect, it } from 'vitest';
import { loadCurriculum } from '../src/utils/progression';
import {
  ONBOARDING_CEILING,
  dayStatuses,
  nextPositionAfter,
  onboardingActive,
  planFor,
} from '../src/utils/dailyPlan';
import { baqarahStudent, baseStudent, session } from './fixtures';

beforeAll(async () => {
  await loadCurriculum();
});

describe('تأسيس جزء عمّ', () => {
  const fresh = baseStudent({
    hifzStartSurah: 114,
    hifzStartAyah: 1,
    hifzDirection: 'nas-to-baqarah',
  });

  it('أول يوم: صفحتان من الناس ١، نوع onboarding، والمراجعة موقوفة', () => {
    expect(onboardingActive(fresh)).toBe(true);
    const h = planFor(fresh, 'hifz');
    expect(h?.kind).toBe('onboarding');
    expect(h?.unit).toBe('أوجه');
    expect(h?.amount).toBe(2);
    expect(h?.from).toEqual({ surah: 114, ayah: 1 });
    expect(planFor(fresh, 'murajaah')).toBeNull();
  });

  it('الكتلة تتراكم من الناس ١ دائماً مهما تقدّم الموضع', () => {
    const later = { ...fresh, currentSurah: 105, currentAyah: 1 };
    const h = planFor(later, 'hifz');
    expect(h?.from).toEqual({ surah: 114, ayah: 1 });
    expect(h?.newFrom).toEqual({ surah: 105, ayah: 1 });
  });

  it('لا يتجاوز نهاية الفجر، ثم يُغلق التأسيس فيغدو الغد الغاشية ١', () => {
    const near = { ...fresh, currentSurah: 90, currentAyah: 10 };
    const h = planFor(near, 'hifz');
    expect(h?.newTo).toEqual(ONBOARDING_CEILING);
    expect(h?.nextStart).toEqual({ surah: 88, ayah: 1 });

    const after = { ...fresh, currentSurah: 88, currentAyah: 1 };
    expect(onboardingActive(after)).toBe(false);
    expect(planFor(after, 'hifz')?.kind).toBe('rolling');
    // وتعود المراجعة تلقائياً
    expect(planFor(after, 'murajaah')).not.toBeNull();
  });

  it('طالبٌ لا يبدأ من الناس ١ ليس في التأسيس', () => {
    const s = baseStudent({ hifzStartSurah: 110, hifzStartAyah: 1, hifzDirection: 'nas-to-baqarah' });
    expect(onboardingActive(s)).toBe(false);
  });

  it('الإيقاف المؤقت يُعلَّم paused ويُلغي التأسيس', () => {
    const p = planFor({ ...fresh, hifzPaused: true }, 'hifz');
    expect(p?.paused).toBe(true);
    expect(p?.kind).not.toBe('onboarding');
  });
});

describe('الحفظ الاعتيادي ونافذة الربط', () => {
  it('بلا نافذة: المقطع الجديد وحده', () => {
    const h = planFor(baqarahStudent(), 'hifz');
    expect(h?.kind).toBe('rolling');
    expect(h?.unit).toBe('أسطر');
    expect(h?.from).toEqual(h?.newFrom);
    expect(h?.from).toEqual({ surah: 2, ayah: 1 });
  });

  it('مع نافذة: تبدأ المهمّة من أقدم مقطعٍ فيها وينتهي عند نهاية الجديد', () => {
    const s = baqarahStudent({
      currentSurah: 2,
      currentAyah: 21,
      hifzWindow: [
        { from: { surah: 2, ayah: 1 }, to: { surah: 2, ayah: 10 } },
        { from: { surah: 2, ayah: 11 }, to: { surah: 2, ayah: 20 } },
      ],
    });
    const h = planFor(s, 'hifz');
    expect(h?.from).toEqual({ surah: 2, ayah: 1 });
    expect(h?.newFrom).toEqual({ surah: 2, ayah: 21 });
    expect(h?.to).toEqual(h?.newTo);
    expect(h?.nextStart?.surah).toBe(2);
    expect(h?.nextStart?.ayah).toBeGreaterThan(21);
  });

  it('مقدار صفر ⇒ لا خطة', () => {
    expect(planFor(baqarahStudent({ hifzTarget: 0 }), 'hifz')).toBeNull();
    expect(planFor(baqarahStudent({ murajaahTarget: 0 }), 'murajaah')).toBeNull();
  });

  it('nextPositionAfter يطابق nextStart في الخطة', () => {
    const s = baqarahStudent();
    expect(nextPositionAfter(s, 'hifz')).toEqual(planFor(s, 'hifz')?.nextStart);
  });
});

describe('dayStatuses', () => {
  it('بلا جلسة ⇒ none للمادتين', () => {
    expect(dayStatuses(null)).toMatchObject({ hifz: 'none', murajaah: 'none' });
  });
  it('تسميع الحفظ وحده لا يُعلّم المراجعة', () => {
    const st = dayStatuses(session('2026-11-15', { hifzResult: 'recited', hifzLines: 5 }));
    expect(st.hifz).toBe('done');
    expect(st.murajaah).toBe('none');
  });
  it('«لم يحفظ» يُعلّم المادة not_recited', () => {
    const st = dayStatuses(session('2026-11-15', { murajaahResult: 'not_recited' }));
    expect(st.murajaah).toBe('not_recited');
  });
});
