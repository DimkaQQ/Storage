import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Category, InventoryItem, Supplier, Purchase, PurchaseStatus } from '../types'

const defaultCategories: Category[] = [
  { id: 'c1', name: 'Мясо и птица', color: 'bg-red-100 text-red-700', icon: '🥩' },
  { id: 'c2', name: 'Рыба и морепродукты', color: 'bg-blue-100 text-blue-700', icon: '🐟' },
  { id: 'c3', name: 'Овощи и фрукты', color: 'bg-green-100 text-green-700', icon: '🥦' },
  { id: 'c4', name: 'Молочные продукты', color: 'bg-yellow-100 text-yellow-700', icon: '🧀' },
  { id: 'c5', name: 'Бакалея', color: 'bg-amber-100 text-amber-700', icon: '🌾' },
  { id: 'c6', name: 'Напитки', color: 'bg-purple-100 text-purple-700', icon: '🍷' },
  { id: 'c7', name: 'Специи и соусы', color: 'bg-orange-100 text-orange-700', icon: '🌶️' },
  { id: 'c8', name: 'Замороженные', color: 'bg-cyan-100 text-cyan-700', icon: '🧊' },
]

const defaultSuppliers: Supplier[] = [
  { id: 's1', name: 'АгроПром', contact: 'Иванов Сергей', phone: '+7 (495) 123-45-67', email: 'agroprom@mail.ru', address: 'Москва, ул. Промышленная, 12', categories: ['c1', 'c3'], rating: 5 },
  { id: 's2', name: 'Океан Фреш', contact: 'Морозова Анна', phone: '+7 (495) 234-56-78', email: 'ocean@fresh.ru', address: 'Москва, Рыбный рынок, 3', categories: ['c2'], rating: 4 },
  { id: 's3', name: 'МолокоПлюс', contact: 'Козлов Дмитрий', phone: '+7 (495) 345-67-89', email: 'moloko@plus.ru', address: 'Подмосковье, пос. Молочный', categories: ['c4'], rating: 5 },
  { id: 's4', name: 'Бакалея Трейд', contact: 'Петрова Елена', phone: '+7 (495) 456-78-90', email: 'bakal@trade.ru', address: 'Москва, ул. Торговая, 8', categories: ['c5', 'c7'], rating: 4 },
  { id: 's5', name: 'ВинТорг', contact: 'Смирнов Алексей', phone: '+7 (495) 567-89-01', email: 'vintorg@ru.ru', address: 'Москва, Садовое кольцо, 45', categories: ['c6'], rating: 3 },
]

const defaultInventory: InventoryItem[] = [
  { id: 'i1', name: 'Говядина (вырезка)', categoryId: 'c1', quantity: 12, unit: 'кг', minQuantity: 5, price: 850, supplierId: 's1', lastUpdated: '2026-06-28' },
  { id: 'i2', name: 'Куриное филе', categoryId: 'c1', quantity: 3, unit: 'кг', minQuantity: 8, price: 320, supplierId: 's1', lastUpdated: '2026-06-27' },
  { id: 'i3', name: 'Свинина (шея)', categoryId: 'c1', quantity: 8, unit: 'кг', minQuantity: 5, price: 420, supplierId: 's1', lastUpdated: '2026-06-28' },
  { id: 'i4', name: 'Лосось свежий', categoryId: 'c2', quantity: 2, unit: 'кг', minQuantity: 4, price: 1200, supplierId: 's2', lastUpdated: '2026-06-28' },
  { id: 'i5', name: 'Тунец', categoryId: 'c2', quantity: 6, unit: 'кг', minQuantity: 3, price: 950, supplierId: 's2', lastUpdated: '2026-06-26' },
  { id: 'i6', name: 'Креветки тигровые', categoryId: 'c2', quantity: 4, unit: 'кг', minQuantity: 2, price: 1400, supplierId: 's2', lastUpdated: '2026-06-27' },
  { id: 'i7', name: 'Томаты', categoryId: 'c3', quantity: 15, unit: 'кг', minQuantity: 10, price: 120, supplierId: 's1', lastUpdated: '2026-06-29' },
  { id: 'i8', name: 'Картофель', categoryId: 'c3', quantity: 1, unit: 'кг', minQuantity: 20, price: 45, supplierId: 's1', lastUpdated: '2026-06-25' },
  { id: 'i9', name: 'Лук репчатый', categoryId: 'c3', quantity: 18, unit: 'кг', minQuantity: 10, price: 35, supplierId: 's1', lastUpdated: '2026-06-28' },
  { id: 'i10', name: 'Морковь', categoryId: 'c3', quantity: 9, unit: 'кг', minQuantity: 8, price: 40, supplierId: 's1', lastUpdated: '2026-06-28' },
  { id: 'i11', name: 'Шпинат', categoryId: 'c3', quantity: 2, unit: 'кг', minQuantity: 3, price: 280, supplierId: 's1', lastUpdated: '2026-06-27' },
  { id: 'i12', name: 'Сливки 33%', categoryId: 'c4', quantity: 8, unit: 'л', minQuantity: 5, price: 180, supplierId: 's3', lastUpdated: '2026-06-28' },
  { id: 'i13', name: 'Пармезан', categoryId: 'c4', quantity: 1.5, unit: 'кг', minQuantity: 2, price: 1800, supplierId: 's3', lastUpdated: '2026-06-26' },
  { id: 'i14', name: 'Масло сливочное', categoryId: 'c4', quantity: 5, unit: 'кг', minQuantity: 3, price: 650, supplierId: 's3', lastUpdated: '2026-06-28' },
  { id: 'i15', name: 'Мука пшеничная', categoryId: 'c5', quantity: 25, unit: 'кг', minQuantity: 15, price: 65, supplierId: 's4', lastUpdated: '2026-06-27' },
  { id: 'i16', name: 'Рис басмати', categoryId: 'c5', quantity: 18, unit: 'кг', minQuantity: 10, price: 140, supplierId: 's4', lastUpdated: '2026-06-27' },
  { id: 'i17', name: 'Оливковое масло', categoryId: 'c5', quantity: 4, unit: 'л', minQuantity: 5, price: 850, supplierId: 's4', lastUpdated: '2026-06-26' },
  { id: 'i18', name: 'Красное вино Chianti', categoryId: 'c6', quantity: 12, unit: 'бут.', minQuantity: 6, price: 1200, supplierId: 's5', lastUpdated: '2026-06-28' },
  { id: 'i19', name: 'Сок апельсиновый', categoryId: 'c6', quantity: 3, unit: 'л', minQuantity: 8, price: 180, supplierId: 's5', lastUpdated: '2026-06-25' },
  { id: 'i20', name: 'Чёрный перец молотый', categoryId: 'c7', quantity: 0.8, unit: 'кг', minQuantity: 0.5, price: 600, supplierId: 's4', lastUpdated: '2026-06-27' },
  { id: 'i21', name: 'Базилик сушёный', categoryId: 'c7', quantity: 0.3, unit: 'кг', minQuantity: 0.3, price: 800, supplierId: 's4', lastUpdated: '2026-06-26' },
  { id: 'i22', name: 'Соевый соус', categoryId: 'c7', quantity: 6, unit: 'л', minQuantity: 4, price: 280, supplierId: 's4', lastUpdated: '2026-06-28' },
]

const defaultPurchases: Purchase[] = [
  {
    id: 'p1', supplierId: 's1', status: 'received',
    items: [
      { itemId: 'i1', name: 'Говядина (вырезка)', quantity: 10, unit: 'кг', price: 850 },
      { itemId: 'i7', name: 'Томаты', quantity: 20, unit: 'кг', price: 120 },
    ],
    totalAmount: 10900, createdAt: '2026-06-20', expectedDate: '2026-06-22', receivedDate: '2026-06-22', notes: 'Плановая поставка'
  },
  {
    id: 'p2', supplierId: 's2', status: 'received',
    items: [
      { itemId: 'i4', name: 'Лосось свежий', quantity: 8, unit: 'кг', price: 1200 },
      { itemId: 'i5', name: 'Тунец', quantity: 5, unit: 'кг', price: 950 },
    ],
    totalAmount: 14350, createdAt: '2026-06-21', expectedDate: '2026-06-23', receivedDate: '2026-06-23', notes: ''
  },
  {
    id: 'p3', supplierId: 's3', status: 'ordered',
    items: [
      { itemId: 'i12', name: 'Сливки 33%', quantity: 10, unit: 'л', price: 180 },
      { itemId: 'i13', name: 'Пармезан', quantity: 3, unit: 'кг', price: 1800 },
    ],
    totalAmount: 7200, createdAt: '2026-06-27', expectedDate: '2026-06-30', notes: 'Срочный заказ'
  },
  {
    id: 'p4', supplierId: 's1', status: 'pending',
    items: [
      { itemId: 'i2', name: 'Куриное филе', quantity: 15, unit: 'кг', price: 320 },
      { itemId: 'i8', name: 'Картофель', quantity: 50, unit: 'кг', price: 45 },
      { itemId: 'i11', name: 'Шпинат', quantity: 5, unit: 'кг', price: 280 },
    ],
    totalAmount: 8550, createdAt: '2026-06-29', expectedDate: '2026-07-01', notes: 'Восполнение запасов'
  },
  {
    id: 'p5', supplierId: 's4', status: 'received',
    items: [
      { itemId: 'i15', name: 'Мука пшеничная', quantity: 30, unit: 'кг', price: 65 },
      { itemId: 'i16', name: 'Рис басмати', quantity: 20, unit: 'кг', price: 140 },
    ],
    totalAmount: 4750, createdAt: '2026-06-18', expectedDate: '2026-06-20', receivedDate: '2026-06-20', notes: ''
  },
  {
    id: 'p6', supplierId: 's5', status: 'ordered',
    items: [
      { itemId: 'i19', name: 'Сок апельсиновый', quantity: 20, unit: 'л', price: 180 },
    ],
    totalAmount: 3600, createdAt: '2026-06-28', expectedDate: '2026-07-02', notes: 'Доставка в понедельник'
  },
  {
    id: 'p7', supplierId: 's2', status: 'pending',
    items: [
      { itemId: 'i4', name: 'Лосось свежий', quantity: 6, unit: 'кг', price: 1200 },
      { itemId: 'i6', name: 'Креветки тигровые', quantity: 4, unit: 'кг', price: 1400 },
    ],
    totalAmount: 12800, createdAt: '2026-06-29', expectedDate: '2026-06-30', notes: 'Для банкета'
  },
  {
    id: 'p8', supplierId: 's4', status: 'cancelled',
    items: [
      { itemId: 'i17', name: 'Оливковое масло', quantity: 10, unit: 'л', price: 850 },
    ],
    totalAmount: 8500, createdAt: '2026-06-15', expectedDate: '2026-06-18', notes: 'Отменён — поставщик не подтвердил'
  },
]

type Store = {
  categories: Category[]
  inventory: InventoryItem[]
  suppliers: Supplier[]
  purchases: Purchase[]
  addInventoryItem: (item: InventoryItem) => void
  updateInventoryItem: (item: InventoryItem) => void
  deleteInventoryItem: (id: string) => void
  addSupplier: (supplier: Supplier) => void
  updateSupplier: (supplier: Supplier) => void
  deleteSupplier: (id: string) => void
  addPurchase: (purchase: Purchase) => void
  updatePurchaseStatus: (id: string, status: PurchaseStatus) => void
  deletePurchase: (id: string) => void
  addCategory: (category: Category) => void
  updateCategory: (id: string, category: Partial<Category>) => void
  deleteCategory: (id: string) => void
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      categories: defaultCategories,
      inventory: defaultInventory,
      suppliers: defaultSuppliers,
      purchases: defaultPurchases,
      addInventoryItem: (item) => set((s) => ({ inventory: [...s.inventory, item] })),
      updateInventoryItem: (item) => set((s) => ({ inventory: s.inventory.map((i) => i.id === item.id ? item : i) })),
      deleteInventoryItem: (id) => set((s) => ({ inventory: s.inventory.filter((i) => i.id !== id) })),
      addSupplier: (supplier) => set((s) => ({ suppliers: [...s.suppliers, supplier] })),
      updateSupplier: (supplier) => set((s) => ({ suppliers: s.suppliers.map((s2) => s2.id === supplier.id ? supplier : s2) })),
      deleteSupplier: (id) => set((s) => ({ suppliers: s.suppliers.filter((s2) => s2.id !== id) })),
      addPurchase: (purchase) => set((s) => ({ purchases: [...s.purchases, purchase] })),
      updatePurchaseStatus: (id, status) => set((s) => ({
        purchases: s.purchases.map((p) => p.id === id ? { ...p, status, ...(status === 'received' ? { receivedDate: new Date().toISOString().slice(0, 10) } : {}) } : p)
      })),
      deletePurchase: (id) => set((s) => ({ purchases: s.purchases.filter((p) => p.id !== id) })),
      addCategory: (category) => set((s) => ({ categories: [...s.categories, { ...category, id: `cat-${Math.random().toString(36).slice(2,8)}` }] })),
      updateCategory: (id, category) => set((s) => ({ categories: s.categories.map((c) => c.id === id ? { ...c, ...category } : c) })),
      deleteCategory: (id) => set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),
    }),
    { name: 'restaurant-warehouse' }
  )
)
