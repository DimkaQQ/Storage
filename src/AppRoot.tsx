import { AuthProvider, useAuth } from './lib/auth'
import { EditsProvider } from './lib/edits'
import App from './App'
import LoginPage from './pages/LoginPage'

function Gate() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400" />
      </div>
    )
  }
  if (!user) return <LoginPage />
  return (
    <EditsProvider>
      <App />
    </EditsProvider>
  )
}

export default function AppRoot() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
