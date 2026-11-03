// Запуск «Проверки цен» на одном компьютере: сайт и сервер — один процесс, доступ с других компьютеров в той же сети.
// Настройки — рядом, в config.json (создаётся при первом запуске). Данные — в папке data (её и нужно копировать для бэкапа).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const cfgPath = join(root, 'config.json')

let cfg
if (existsSync(cfgPath)) {
  cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
} else {
  // читаемый случайный пароль для первого входа (без похожих символов)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ23456789'
  const bytes = randomBytes(10)
  const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  cfg = { port: 8080, adminEmail: 'admin@admin.com', adminPassword: password, timezone: 'Asia/Almaty' }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Первый запуск. Данные для входа (запишите, потом смените пароль в программе):')
  console.log(`  Почта:  ${cfg.adminEmail}`)
  console.log(`  Пароль: ${cfg.adminPassword}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

const dataDir = join(root, 'data')
mkdirSync(dataDir, { recursive: true })

process.env.PORT = String(cfg.port ?? 8080)
process.env.DATA_DIR = dataDir
process.env.STATIC_DIR = join(root, 'dist')
process.env.ADMIN_EMAIL = cfg.adminEmail || 'admin@admin.com'
process.env.ADMIN_PASSWORD = cfg.adminPassword || 'demo1234'
process.env.TZ = process.env.TZ || cfg.timezone || 'Asia/Almaty'
process.env.NODE_ENV = 'production'

await import(pathToFileURL(join(root, 'server', 'src', 'index.js')).href)
