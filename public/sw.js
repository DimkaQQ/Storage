// «Убийца» Service Worker'а — этот домен раньше держал другое приложение
// (склад/инвентарь), собранное как offline-first PWA через vite-plugin-pwa/
// Workbox (registerType: 'autoUpdate'), зарегистрированный ровно на этом же
// адресе /sw.js. Раз новый сайт (Проверка цен) больше не PWA и вообще не
// отдавал /sw.js — у браузеров, где старый SW уже стоял, не было валидного
// файла, чтобы на него обновиться (сервер отвечал HTML вместо JS, апдейт
// молча падал), и старый SW навсегда оставался активным — подсовывал
// закэшированный склад вместо актуального сайта на каждой обычной
// перезагрузке страницы.
//
// Это тот самый новый валидный файл по тому же адресу: браузер рано или
// поздно (обычно на следующей навигации, «autoUpdate» проверяет часто)
// увидит, что байты изменились, установит его как обновление — а он,
// вместо того чтобы кэшировать что-либо, тут же чистит все кэши, снимает
// сам себя с регистрации и перегружает открытые вкладки, чтобы они пошли
// в сеть за настоящим текущим сайтом.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.registration.unregister()
      const clientsList = await self.clients.matchAll({ type: 'window' })
      for (const client of clientsList) client.navigate(client.url)
    })(),
  )
})
