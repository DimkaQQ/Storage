// Журнал действий: «кто что сделал». Запись никогда не должна ломать само действие, поэтому любые ошибки только в лог.
import { logAudit } from './editsDb.js'

export const CAT = { EDITS: 'Справочники', DATA: 'Данные', PRICES: 'Цены', TEAM: 'Команда', SYSTEM: 'Система', LOGIN: 'Вход' }

/** Запись от имени вошедшего пользователя (req.auth заполняет requireAuth). */
export function audit(req, category, action, details = '') {
  try {
    logAudit(req.auth.orgId, { userId: req.auth.id, email: req.auth.email, category, action, details })
  } catch (e) { console.error('[audit]', e?.message || e) }
}

/** Запись по пользователю напрямую (вход, когда req.auth ещё нет). */
export function auditUser(user, category, action, details = '') {
  try {
    logAudit(user.orgId, { userId: user.id, email: user.email, category, action, details })
  } catch (e) { console.error('[audit]', e?.message || e) }
}

const cut = (v, n = 90) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
// ключ строки матрицы/привязки: «ресторан::поставщик::товар[::фасовка]» → «ресторан · поставщик · товар»
const keyLabel = (key) => String(key ?? '').split('::').slice(0, 3).filter(Boolean).map((x) => cut(x, 50)).join(' · ')
const VENUE_FIELDS = { city: 'город', brand: 'бренд', entity: 'юрлицо', category: 'категория', alias: 'название у нас', matrix: 'вкладка матрицы' }

/** Человеческое описание правки из Справочников/Проверки цен: [категория, действие, подробности]. */
export function describeEdit(type, p = {}) {
  const E = CAT.EDITS
  switch (type) {
    case 'renameProduct': return [E, 'Переименовал товар', `${cut(p.original)} → ${cut(p.name) || '(название сброшено)'}`]
    case 'renameSupplier': return [E, 'Переименовал компанию', `${cut(p.original)} → ${cut(p.name) || '(название сброшено)'}`]
    case 'setVenue': return [E, 'Изменил точку', `${cut(p.restaurant)}: ${Object.keys(p.patch || {}).map((k) => VENUE_FIELDS[k] || k).join(', ') || 'настройки'}`]
    case 'clearVenue': return [E, 'Сбросил настройки точки', cut(p.restaurant)]
    case 'addVenue': return [E, 'Добавил точку', cut(p.name)]
    case 'removeVenue': return [E, 'Убрал точку', cut(p.name)]
    case 'acknowledgeSupplier': return [E, 'Подтвердил компанию', cut(p.rawName)]
    case 'unacknowledgeSupplier': return [E, 'Снял подтверждение компании', cut(p.rawName)]
    case 'setProductPackOverride': return [E, 'Изменил правило фасовки', `${cut(p.product)}: ${p.value ? 'фасовка важна' : 'фасовка не важна'}`]
    case 'setPackAlias': return [E, p.value == null ? 'Убрал привязку фасовки' : 'Привязал фасовку', keyLabel(p.key)]
    case 'setProductLink':
      return p.value == null || !p.value.targetProduct
        ? [E, 'Отвязал товар', keyLabel(p.key)]
        : [E, 'Привязал товар', `${keyLabel(p.key)} → ${cut(p.value.targetProduct)}`]
    case 'setProductLinks': {
      const items = Array.isArray(p.items) ? p.items : []
      const sample = items.slice(0, 3).map((it) => `${keyLabel(it?.key)} → ${cut(it?.value?.targetProduct) || 'отвязка'}`).join('; ')
      return [E, `Привязал товары (${items.length} шт.)`, sample + (items.length > 3 ? '…' : '')]
    }
    case 'setSupplierLinks': {
      const items = Array.isArray(p.items) ? p.items : []
      const sample = items.slice(0, 3).map((it) => `${cut(it?.value?.rawSupplier || keyLabel(it?.key), 50)} → ${cut(it?.value?.canon) || 'снята'}`).join('; ')
      return [E, `Привязал компании (${items.length} шт.)`, sample + (items.length > 3 ? '…' : '')]
    }
    case 'setPlanOverride': return [E, p.value == null ? 'Сбросил свою плановую цену' : 'Изменил плановую цену', `${keyLabel(p.key)}${p.value == null ? '' : ` → ${p.value}`}`]
    case 'setRowComment': return [E, String(p.value || '').trim() ? 'Оставил комментарий' : 'Удалил комментарий', `${keyLabel(p.key)}${String(p.value || '').trim() ? `: «${cut(p.value, 120)}»` : ''}`]
    case 'setRowColor': return [E, p.value == null ? 'Убрал цвет строки' : 'Покрасил строку', keyLabel(p.key)]
    case 'setAmbiguousChoice': return [E, p.value == null ? 'Сбросил выбор цены' : 'Выбрал вариант цены', keyLabel(p.key)]
    case 'reset': return [CAT.SYSTEM, 'Сбросил все правки организации', '']
    default: return [E, 'Изменил справочник', cut(type)]
  }
}

/** Запись правки справочника: никогда не бросает (описание строится из пришедших данных, они могут быть любыми). */
export function auditEdit(req, type, payload) {
  try {
    const [c, a, d] = describeEdit(type, payload && typeof payload === 'object' ? payload : {})
    audit(req, c, a, d)
  } catch (e) { console.error('[audit]', e?.message || e) }
}

// неудачные входы пишем не чаще раза в минуту на почту — иначе подбор пароля забьёт журнал и базу
const failedLogged = new Map()
export function auditFailedLogin(user) {
  const now = Date.now()
  if (now - (failedLogged.get(user.email) ?? 0) < 60_000) return
  failedLogged.set(user.email, now)
  if (failedLogged.size > 5000) failedLogged.clear()
  auditUser(user, CAT.LOGIN, 'Неудачная попытка входа', 'неверный пароль')
}
