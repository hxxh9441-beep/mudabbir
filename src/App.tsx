// src/App.tsx
import HomeView from './components/HomeView';
import ToastHost from './components/ToastHost';
import { ThemeProvider } from './utils/theme';

function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-transparent dark:bg-transparent" dir="rtl">
        <HomeView />
        <ToastHost />
      </div>
    </ThemeProvider>
  );
}

export default App;
