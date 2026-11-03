// Запуск «Проверки цен» на одном компьютере: сайт и сервер — один процесс, доступ с других компьютеров в той же сети.
// Всё настраивается само: config.json создаётся при первом запуске, данные — в папке data (её и копируют для бэкапа).
// Если рядом лежит restore.tar (полная копия из программы: «Обновление» → «Скачать бэкап»), данные и логины берутся из неё.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const root = dirname(fileURLToPath(import.meta.url))
const cfgPath = join(root, 'config.json')
const dataDir = join(root, 'data')
mkdirSync(dataDir, { recursive: true })

// 1) перенос данных: restore.tar → data (только если программа ещё «пустая»)
let restored = false
const restoreFile = ['restore.tar', 'restore.tar.gz', 'restore.tgz'].map((n) => join(root, n)).find((f) => existsSync(f))
if (restoreFile && !existsSync(join(dataDir, 'users.json'))) {
  console.log(`Переношу данные из ${restoreFile}…`)
  const r = spawnSync('tar', ['-xf', restoreFile, '-C', dataDir], { stdio: 'inherit' })
  if (r.status === 0 && existsSync(join(dataDir, 'users.json'))) {
    restored = true
    renameSync(restoreFile, restoreFile + '.done')
    console.log('Данные перенесены. Входить нужно с теми же логинами и паролями, что на старом месте.')
  } else {
    console.error('Не удалось развернуть restore.tar (нужна команда tar — есть в Windows 10/11, Mac и Linux). Программа запустится пустой.')
  }
}

// 2) настройки
let cfg
if (existsSync(cfgPath)) {
  cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
} else {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ23456789'
  const password = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join('')
  cfg = { port: 8080, adminEmail: 'admin@admin.com', adminPassword: password, timezone: 'Asia/Almaty' }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  if (!restored) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Первый запуск. Данные для входа (запишите, потом смените пароль в программе):')
    console.log(`  Почта:  ${cfg.adminEmail}`)
    console.log(`  Пароль: ${cfg.adminPassword}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  }
}

const port = Number(cfg.port ?? 8080)
process.env.PORT = String(port)
process.env.DATA_DIR = dataDir
process.env.STATIC_DIR = join(root, 'dist')
process.env.ADMIN_EMAIL = cfg.adminEmail || 'admin@admin.com'
process.env.ADMIN_PASSWORD = cfg.adminPassword || 'demo1234'
process.env.TZ = process.env.TZ || cfg.timezone || 'Asia/Almaty'
process.env.NODE_ENV = 'production'

await import(pathToFileURL(join(root, 'server', 'src', 'index.js')).href)

// 3) адрес для сотрудников — в файл рядом с программой + открыть сайт на этом компьютере
const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
const lines = ['Адрес программы для сотрудников (компьютер или телефон в этой же сети Wi-Fi):', '', ...ips.map((ip) => `  http://${ip}:${port}`), '', `На этом компьютере: http://localhost:${port}`]
try { writeFileSync(join(root, 'АДРЕС ДЛЯ СОТРУДНИКОВ.txt'), lines.join('\r\n') + '\r\n') } catch { /* не критично */ }
if (!process.env.NO_BROWSER) {
  const url = `http://localhost:${port}`
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref() } catch { /* не критично */ }
}
