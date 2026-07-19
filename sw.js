// ══════════════════════════════════════════════════════════════════
// sw.js — Service Worker أساسي للعقارات السورية
// وظيفته: (1) تلبية شرط Chrome لإمكانية التثبيت (Installability)
//         (2) تخزين مؤقت (Cache) لهيكل التطبيق الأساسي للعمل دون اتصال جزئياً
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'syria-estate-v1';

// الملفات الأساسية للواجهة (App Shell) — تُخزَّن فور التثبيت
const APP_SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/profile.html',
  '/add-property.html',
  '/details.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/img/logo.png',
  '/img/favicon.png'
];

// ── التثبيت: تخزين ملفات الواجهة الأساسية ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // نستخدم إضافة فردية متسامحة مع الأخطاء بدل addAll الصارمة
      // كي لا يفشل التثبيت كاملاً إذا تعذّر تحميل ملف واحد (مثل صورة لم تُرفع بعد)
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('⚠️ SW: تعذّر تخزين', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// ── التفعيل: حذف أي كاش قديم من نسخة سابقة ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── الجلب: استراتيجية Network First مع الرجوع للكاش عند انقطاع الاتصال ──
// (مناسبة لموقع بياناته حيّة عبر Supabase؛ لا نريد تقديم بيانات عقارات قديمة من الكاش)
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // لا نتدخل في طلبات API الخاصة بـ Supabase — تمر مباشرة للشبكة دائماً
  if (req.url.includes('supabase.co')) return;

  // فقط طلبات GET قابلة للتخزين المؤقت
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return response;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
