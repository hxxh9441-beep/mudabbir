import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * تسجيل العامل الخادميّ (PWA): يجعل التطبيق يعمل **بلا شبكة** ويُحدّث نفسه.
 * `immediate: true` ⇒ يُسجَّل فوراً بلا انتظار حدث load (أسرع في التقاط
 * النسخة الأولى). ومع `registerType: 'autoUpdate'` في vite.config فإنّ أيّ
 * نسخةٍ جديدة تُفعَّل تلقائياً في الخلفيّة — بلا نافذة «يوجد تحديث» ولا تدخّل
 * من المعلّم. البيانات في IndexedDB لا تتأثّر بالتحديث إطلاقاً.
 */
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}
