import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles/ui.css'
import { PopupApp } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('popup root 不存在')
createRoot(container).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
)
