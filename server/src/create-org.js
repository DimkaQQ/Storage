#!/usr/bin/env node
/**
 * Создаёт НОВУЮ организацию (отдельную сеть со своими данными) и её первого администратора — для клиента, который работает на общем сервере.
 *
 *   docker exec pricecheck-api node src/create-org.js "Название сети" admin@почта.com "пароль"
 *
 * Данные других организаций не затрагиваются. Дальше клиент заходит под этим админом, в «Обновление → Резервная копия» делает
 * «Восстановить всё из копии» (restore.tar с его прежней установки) — вернутся данные, доступы, связи и пользователи.
 */
import { listOrgs, createOrg, createUser, findUserByEmail } from './store.js'
import { hashPassword } from './auth.js'

const [name, email, password] = process.argv.slice(2)
if (!name || !email || !password) {
  console.error('Использование: node src/create-org.js "Название сети" admin@почта.com "пароль"')
  process.exit(1)
}
if (password.length < 8) { console.error('Пароль — не короче 8 символов'); process.exit(1) }
if (findUserByEmail(email)) { console.error(`Пользователь ${email} уже есть — выберите другую почту`); process.exit(1) }
if (listOrgs().some((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase())) { console.error(`Организация «${name}» уже есть`); process.exit(1) }

const org = createOrg(name)
createUser({ email, passwordHash: hashPassword(password), orgId: org.id, role: 'admin' })
console.log(`Готово: организация «${org.name}» (id ${org.id}), админ ${email}. Теперь можно входить на сайте.`)
