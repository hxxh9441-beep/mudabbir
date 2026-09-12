// src/App.tsx
import HomeView from './components/HomeView';
import { ThemeProvider } from './utils/theme';

function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-transparent dark:bg-transparent" dir="rtl">
        <HomeView />
      </div>
    </ThemeProvider>
  );
}

export default App;
