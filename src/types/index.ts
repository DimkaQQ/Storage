export type Venue = {
  id: string
  name: string
  address: string
}

export type Category = {
  id: string
  name: string
  color: string
  icon: string
}

export type InventoryItem = {
  id: string
  name: string
  categoryId: string
  quantity: number
  unit: string
  minQuantity: number
  price: number
  supplierId: string
  lastUpdated: string
  venueId: string
  location?: string
  notes?: string
}

export type Supplier = {
  id: string
  name: string
  contact: string
  phone: string
  email: string
  address: string
  categories: string[]
  rating: number
  notes?: string
}

export type PurchaseStatus = 'pending' | 'ordered' | 'received' | 'cancelled'

export type PurchaseItem = {
  itemId: string
  name: string
  quantity: number
  unit: string
  price: number
}

export type Purchase = {
  id: string
  supplierId: string
  venueId: string
  status: PurchaseStatus
  items: PurchaseItem[]
  totalAmount: number
  createdAt: string
  expectedDate: string
  receivedDate?: string
  notes: string
}

export type ActivityEvent = {
  id: string
  type: 'purchase_created' | 'purchase_received' | 'stock_updated' | 'supplier_added' | 'item_added'
  description: string
  timestamp: string
  relatedId?: string
}
