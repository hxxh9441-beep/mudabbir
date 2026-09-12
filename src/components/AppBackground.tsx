// src/components/AppBackground.tsx
// **خلفيّة مُدَبِّر الموحَّدة** — مصدرٌ واحد للدفء البصريّ في كل الشاشات.
//
// السبب: `.app-bg` لونٌ مسطّح (رقٌّ باهت)، والدفء الذي يراه المعلّم في الشاشة
// الرئيسيّة إنّما يأتي من ثلاث هالاتٍ ضوئيّة دافئة (كهرمانيّ/برتقاليّ/ذهبيّ).
// كانت هذه الهالات مكتوبةً **داخل الرئيسيّة وحدها**، فبقيت شاشة الحلقة وخطّة
// الطالب باردتين مسطّحتين. هنا صارت مكوّناً واحداً يُستدعى في الجذور كلها،
// فلا يمكن أن تنحرف خلفيّةٌ عن أختها أبداً.
//
// الاستعمال: يوضع داخل عنصرٍ ذي `app-bg` (الذي يعطي اللون الأساسيّ والنصّ).
export default function AppBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* ١ — رقٌّ شمسيّ خفيف: تدرّجٌ عموديّ دافئ (فاتح) / موكا عميق (داكن) */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#FBF5EF] via-[#F5EFEB] to-[#EFE5DC] dark:from-[#1B120D] dark:via-[#120D0A] dark:to-[#0D0806]" />
      {/* ٢ — الهالات الثلاث الدافئة (نفس قيم الرئيسيّة حرفياً) */}
      <div className="absolute -top-32 -start-24 h-80 w-80 rounded-full bg-amber-200/50 blur-3xl dark:bg-amber-500/10" />
      <div className="absolute top-1/3 -end-24 h-96 w-96 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-500/10" />
      <div className="absolute bottom-0 start-1/3 h-72 w-72 rounded-full bg-yellow-200/40 blur-3xl dark:bg-yellow-500/10" />
    </div>
  );
}
