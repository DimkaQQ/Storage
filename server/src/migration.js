// «Полная копия для переноса»: всё содержимое папки данных (закупки, матрицы, каталог, связи, настройки подключения,
// пользователи) одним tar-файлом. Его кладут рядом с локальной установкой (restore.tar) — при первом запуске она сама
// развернёт данные, и все логины/настройки будут как были. Файл содержит пароли и ключи — отдавать только владельцу.
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { snapshotTo } from './editsDb.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
// живую базу (с WAL) и ключ подписи входа в копию не кладём: база берётся согласованным снимком, ключ создаётся заново
const SKIP = new Set(['edits.db', 'edits.db-wal', 'edits.db-shm', 'jwt-secret.txt'])

const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'

function header(name, size, mtime) {
  const b = Buffer.alloc(512)
  let prefix = ''
  let nm = name
  if (Buffer.byteLength(nm) > 100) {
    const i = nm.lastIndexOf('/', 155)
    if (i < 0) throw new Error(`Слишком длинное имя файла: ${name}`)
    prefix = nm.slice(0, i); nm = nm.slice(i + 1)
  }
  b.write(nm, 0, 100, 'utf8')
  b.write('0000644\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116)
  b.write(octal(size, 12), 124); b.write(octal(Math.floor(mtime / 1000), 12), 136)
  b.write('        ', 148) // контрольная сумма считается по пробелам
  b.write('0', 156)
  b.write('ustar\0', 257); b.write('00', 263)
  if (prefix) b.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (let i = 0; i < 512; i++) sum += b[i]
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return b
}

// из settings.json убираем только секреты (пароль/логин iiko, ключ Google); остальное (флаги, расписание) оставляем —
// иначе копия вела бы себя иначе, чем оригинал (например, без ручного режима)
const SECRET_FIELDS = ['password', 'login', 'apiLogin', 'googleServiceAccountKey']
function sanitizeSettings(buf) {
  try {
    const o = JSON.parse(buf.toString('utf8'))
    for (const f of SECRET_FIELDS) if (f in o) o[f] = ''
    return Buffer.from(JSON.stringify(o, null, 2))
  } catch { return Buffer.from('{}') }
}

function walk(dir, base, out, withSecrets) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    const st = statSync(full)
    if (st.isDirectory()) walk(full, rel, out, withSecrets)
    else if (SKIP.has(rel)) continue
    else if (!withSecrets && name === 'users.json') continue // пользователи и хэши паролей
    else if (!withSecrets && name === 'settings.json') out.push({ rel, full, mtime: st.mtimeMs, sanitize: true }) // настройки — без секретов
    else out.push({ rel, full, mtime: st.mtimeMs })
  }
}

// withSecrets=false — копия «для разработчика»: без настроек подключения (пароль iiko, ключ Google) и без пользователей
export function buildDataTar(withSecrets = true) {
  const files = []
  walk(DATA_DIR, '', files, withSecrets)
  const tmp = join(tmpdir(), `pricecheck-edits-${randomBytes(6).toString('hex')}.db`)
  snapshotTo(tmp)
  files.push({ rel: 'edits.db', full: tmp, mtime: Date.now() })
  const parts = []
  try {
    for (const f of files) {
      let data = readFileSync(f.full)
      if (f.sanitize) data = sanitizeSettings(data)
      parts.push(header(f.rel, data.length, f.mtime), data)
      const pad = (512 - (data.length % 512)) % 512
      if (pad) parts.push(Buffer.alloc(pad))
    }
  } finally {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}


/**
 * Читает из tar (или tar.gz) только нужные файлы: wanted(путь) -> true. Возвращает Map путь -> Buffer.
 * Разбор ustar (то, что пишет buildDataTar и обычный `tar`), плюс длинные имена GNU (тип L) и PAX (тип x, запись path=).
 * Ссылки и каталоги пропускаются; на повреждённом файле чтение просто останавливается.
 */
export function readTarFiles(input, wanted) {
  let buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: 600 * 1024 * 1024 })
  const out = new Map()
  const str = (o, n) => { const e = buf.indexOf(0, o); return buf.toString('utf8', o, e === -1 || e > o + n ? o + n : e) }
  const zeroBlock = (o) => { for (let i = o; i < o + 512; i++) if (buf[i] !== 0) return false; return true }
  let off = 0, longName = null
  while (off + 512 <= buf.length) {
    if (zeroBlock(off)) break // пустой блок — конец архива
    const size = parseInt(str(off + 124, 12).trim() || '0', 8)
    if (!Number.isFinite(size) || size < 0) break // не tar или неподдерживаемый размер
    const type = String.fromCharCode(buf[off + 156] || 48)
    const data = off + 512
    if (data + size > buf.length) break
    if (type === 'L') longName = buf.toString('utf8', data, data + size).replace(/\0+$/, '')
    else if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(buf.toString('utf8', data, data + size))
      if (m) longName = m[1]
    } else if (type === '0' || type === '\0') {
      const prefix = str(off + 345, 155)
      const name = (longName ?? ((prefix ? prefix + '/' : '') + str(off, 100))).replace(/^\.\//, '')
      longName = null
      if (wanted(name)) out.set(name, buf.subarray(data, data + size))
    } else if (type !== 'g') longName = null
    off = data + Math.ceil(size / 512) * 512
  }
  return out
}
