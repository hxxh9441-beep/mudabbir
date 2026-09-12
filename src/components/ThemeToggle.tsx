// src/components/ThemeToggle.tsx
import { useThemeContext } from '../utils/theme';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const { isDark, toggle } = useThemeContext();

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      className="press flex h-11 w-11 items-center justify-center rounded-full border border-amber-900/10 bg-amber-50/80 text-[#B8860B] shadow-sm backdrop-blur-xl transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-[#241A14]/70 dark:text-amber-300 dark:hover:bg-[#2f2118]"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
