// src/components/ErrorBoundary.tsx
// **حاجزُ الخطأ**: أيُّ استثناءٍ أثناء العرض يُلتقط ويُعرض بصفحةٍ مفهومة، بدل
// أن تبقى الشاشة بيضاء فارغة. البيانات في IndexedDB لا تتأثّر — الخطأ في
// الواجهة وحدها، فيُعطي المعلّم «إعادة المحاولة» و«رجوع».
import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; onBack?: () => void; label?: string };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[مُدَبِّر] خطأ في الواجهة:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-bg fixed inset-0 z-[95] flex flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10 text-3xl">
          ⚠️
        </span>
        <p className="text-lg font-extrabold text-[#2D1F17] dark:text-[#F5EBE1]">
          تعذّر عرض {this.props.label ?? 'هذه الصفحة'}
        </p>
        <p className="max-w-sm text-sm font-semibold text-[#7a6450] dark:text-amber-100/60">
          حدث خطأٌ غير متوقّع في الواجهة — وبياناتك في الجهاز سليمة.
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="press rounded-2xl bg-[#B8860B] px-5 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-amber-700/30 hover:brightness-110"
          >
            إعادة المحاولة
          </button>
          {this.props.onBack ? (
            <button
              onClick={() => {
                this.setState({ error: null });
                this.props.onBack?.();
              }}
              className="press rounded-2xl bg-black/[0.06] px-5 py-2.5 text-sm font-bold text-[#5A4636] hover:bg-black/10 dark:bg-white/10 dark:text-amber-100"
            >
              رجوع
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}
