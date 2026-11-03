// «Полная копия для переноса»: всё содержимое папки данных (закупки, матрицы, каталог, связи, настройки подключения,
// пользователи) одним tar-файлом. Его кладут рядом с локальной установкой (restore.tar) — при первом запуске она сама
// развернёт данные, и все логины/настройки будут как были. Файл содержит пароли и ключи — отдавать только владельцу.
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
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

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    const st = statSync(full)
    if (st.isDirectory()) walk(full, rel, out)
    else if (!SKIP.has(rel)) out.push({ rel, full, mtime: st.mtimeMs })
  }
}

export function buildDataTar() {
  const files = []
  walk(DATA_DIR, '', files)
  const tmp = join(tmpdir(), `pricecheck-edits-${randomBytes(6).toString('hex')}.db`)
  snapshotTo(tmp)
  files.push({ rel: 'edits.db', full: tmp, mtime: Date.now() })
  const parts = []
  try {
    for (const f of files) {
      const data = readFileSync(f.full)
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
