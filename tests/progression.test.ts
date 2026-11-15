import { beforeAll, describe, expect, it } from 'vitest';
import {
  globalIndex,
  loadCurriculum,
  nextPosition,
  positionAt,
  surahCount,
} from '../src/utils/progression';
import {
  earlierInDirection,
  nextHifzWindow,
  positionAfterRecited,
} from '../src/utils/dailyPlan';

beforeAll(async () => {
  await loadCurriculum();
});

describe('progression', () => {
  it('فهرس المنهج ١١٤ سورة', () => {
    expect(surahCount()).toBe(114);
  });
  it('globalIndex ⇄ positionAt ذهاباً وإياباً', () => {
    for (const [s, a] of [[1, 1], [2, 286], [114, 6], [36, 83]] as const) {
      const i = globalIndex(s, a);
      expect(i).not.toBeNull();
      expect(positionAt(i as number)).toEqual({ surah: s, ayah: a });
    }
  });
  it('آية غير موجودة ⇒ null', () => {
    expect(globalIndex(1, 8)).toBeNull();
    expect(globalIndex(115, 1)).toBeNull();
  });
  it('الاتجاه من الناس إلى البقرة: آخر آية في الناس ثم الفلق', () => {
    expect(nextPosition({ surah: 114, ayah: 5 }, 'nas-to-baqarah')).toEqual({ surah: 114, ayah: 6 });
    const after = nextPosition({ surah: 114, ayah: 6 }, 'nas-to-baqarah');
    expect(after?.surah).toBe(113);
  });
  it('الاتجاه من البقرة إلى الناس: بعد آخر البقرة تبدأ آل عمران', () => {
    expect(nextPosition({ surah: 2, ayah: 286 }, 'baqarah-to-nas')).toEqual({ surah: 3, ayah: 1 });
  });
  it('نهاية المصحف في اتجاه السير ⇒ لا موضع تالٍ', () => {
    expect(nextPosition({ surah: 114, ayah: 6 }, 'baqarah-to-nas')).toBeNull();
  });
});

describe('الجدولة التكيّفية', () => {
  it('positionAfterRecited: من سُمِع إلى آية ما يبدأ الغد من التي تليها', () => {
    expect(positionAfterRecited({ surah: 2, ayah: 10 }, 'baqarah-to-nas')).toEqual({
      surah: 2,
      ayah: 11,
    });
  });
  it('earlierInDirection يختار الأسبق سيراً', () => {
    const a = { surah: 2, ayah: 5 };
    const b = { surah: 3, ayah: 1 };
    expect(earlierInDirection(a, b, 'baqarah-to-nas')).toEqual(a);
    expect(earlierInDirection(a, b, 'nas-to-baqarah')).toEqual(b);
    // داخل السورة الواحدة الآيات تتصاعد في الاتجاهين
    const c = { surah: 2, ayah: 9 };
    expect(earlierInDirection(a, c, 'nas-to-baqarah')).toEqual(a);
  });
  it('نافذة الربط تُبقي آخر مقطعين فقط', () => {
    const p = (n: number) => ({ from: { surah: 1, ayah: n }, to: { surah: 1, ayah: n + 1 } });
    expect(nextHifzWindow(undefined, p(1))).toEqual([p(1)]);
    expect(nextHifzWindow([p(1), p(3)], p(5))).toEqual([p(3), p(5)]);
  });
});
