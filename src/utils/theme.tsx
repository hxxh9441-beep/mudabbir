// src/utils/theme.tsx
import { useState, useEffect, createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'mudabbir:theme';

// Define the context
export const ThemeContext = createContext<ReturnType<typeof useTheme>>(null!);

// Custom hook to manage theme.
// Priority: the teacher's EXPLICIT choice (persisted) → the OS preference.
// The mushaf is designed for the dark OLED look, so the choice must survive
// refreshes instead of snapping back to light mode every time.
export const useTheme = () => {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
    } catch {
      /* storage unavailable — fall through */
    }
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    // Follow the OS theme only while the user has not made an explicit choice.
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return; // explicit choice wins
      } catch {
        /* ignore */
      }
      setIsDark(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggle = () => {
    setIsDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { isDark, toggle };
};

// Provider component
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const theme = useTheme();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.isDark);
  }, [theme.isDark]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

// Hook to use the theme context
export const useThemeContext = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
};
