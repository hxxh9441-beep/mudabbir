// src/utils/scoreColor.ts
// ألوان الدرجة (من ٢٠) على فئاتٍ واضحة لا مسارٍ متّصل:
//   أخضر ١٦–٢٠ · كهرمانيّ ١٢–١٥ · برتقاليّ ٨–١١ · أحمر ٠–٧
// السبب: التدريج المتّصل يمرّ بين الأخضر والكهرمان بالأصفر الليمونيّ/الزيتونيّ
// (كانت ١٦/٢٠ تُخرج oklch زيتونياً لا أخضر ولا كهرماناً)، فالفئات تعطي لوناً
// معروفاً لكل شريحة: أخضر عند الإتقان، كهرمان/برتقاليّ في الوسط، أحمر عند التدنّي.
// والدرجة صفر لا تُعرض كرقم أبداً: لها شارة «لم يحفظ» الحمراء.

/** فئات الدرجة — كلّها داكنة بما يكفي لنصٍّ أبيض فوقها (تباين ≥ ٤.٥ مقيس). */
const BAND_COLOR: Record<ScoreBand, string> = {
  green: 'hsl(142 65% 32%)', // ١٦–٢٠
  amber: 'hsl(38 85% 33%)', // ١٢–١٥
  orange: 'hsl(24 88% 36%)', // ٨–١١
  red: 'hsl(0 65% 36%)', // ٠–٧
};

export type ScoreBand = 'green' | 'amber' | 'orange' | 'red';

/** فئة الدرجة (نفس حدود الألوان) — تُسقط أي مقياسٍ على مقياس ٢٠. */
export function scoreBand(score: number, max = 20): ScoreBand {
  const s = Math.max(0, Math.min(max, score));
  const on20 = max === 20 ? s : (s / max) * 20;
  return on20 >= 16 ? 'green' : on20 >= 12 ? 'amber' : on20 >= 8 ? 'orange' : 'red';
}

/** لون الدرجة على الفئات (٢٠ ⇒ أخضر · ١٥ ⇒ كهرمان · ١٠ ⇒ برتقال · ≤٧ ⇒ أحمر). */
export function scoreColor(score: number, max = 20): string {
  return BAND_COLOR[scoreBand(score, max)];
}

/** هل نعرض هذه الدرجة كـ«لم يحفظ» بدل رقم؟ (الصفر لا يُعرض أبداً) */
export const isZeroScore = (score?: number): boolean => score !== undefined && score <= 0;

/** ما يُكتب في الشارة: رقم الدرجة، أو «لم يحفظ» عند الصفر.
 *  بالأرقام العربية الهندية كسائر التطبيق («٢٠/٢٠» لا «20/20»). */
export function scoreText(score?: number, max = 20): string {
  if (score === undefined) return 'تمّ';
  if (isZeroScore(score)) return 'لم يحفظ';
  const ar = (v: number) => String(v).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  return `${ar(score)}/${ar(max)}`;
}
