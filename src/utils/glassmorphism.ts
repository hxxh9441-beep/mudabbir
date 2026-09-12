// src/utils/glassmorphism.ts
// Legacy token helper — retained for reference; the active UI uses the
// `glass` / `glass-strong` CSS utilities (see index.css). Kept warm to
// match the مُدَبِّر brown/caramel palette.

export const glassmorphicClasses = {
  light: 'bg-amber-50/80 backdrop-blur-xl border border-amber-900/10 rounded-2xl',
  dark: 'bg-[#241A14]/70 backdrop-blur-xl border border-amber-500/15 rounded-2xl',
};

export const themeTokens = {
  light: {
    bg: 'bg-[#F5EFEB]',
    text: 'text-[#2D1F17]',
    border: 'border-amber-900/10',
    shadow: 'shadow-sm',
  },
  dark: {
    bg: 'bg-[#120D0A]',
    text: 'text-[#F5EBE1]',
    border: 'border-amber-500/15',
    shadow: 'shadow-2xl',
  },
};

// Export a function to get the correct classes based on the current theme
export const getGlassClasses = (isDark: boolean) => {
  return isDark ? glassmorphicClasses.dark : glassmorphicClasses.light;
};
