import React from 'react'
import ReactDOM from 'react-dom/client'
import AppRoot from './AppRoot'
import './index.css'

// Этот домен раньше держал другое приложение (склад/инвентарь, PWA — со
// своим Service Worker'ом и офлайн-кэшем). SW переживает абсолютно любой
// новый деплой — он живёт в браузере пользователя, а не на сервере, и
// продолжает молча подсовывать старый закэшированный сайт вместо нового,
// пока его явно не снять. Именно поэтому обычная перезагрузка страницы
// открывала древний склад: браузер даже не доходил до сети, SW отвечал
// сам, из своего кэша. Сама эта сборка ничего не регистрирует, но нужно
// явно убрать то, что уже могло остаться от прошлого приложения —
// безопасно и один раз (если регистраций нет, циклы просто пустые).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister()
  }).catch(() => { /* ignore */ })
}
if ('caches' in window) {
  caches.keys().then((keys) => {
    for (const key of keys) caches.delete(key)
  }).catch(() => { /* ignore */ })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
)
