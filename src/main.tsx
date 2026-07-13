import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EditsProvider } from './lib/edits'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditsProvider>
      <App />
    </EditsProvider>
  </React.StrictMode>,
)
