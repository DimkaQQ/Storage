import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Suppliers from './pages/Suppliers'
import Analytics from './pages/Analytics'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </Layout>
  )
}
