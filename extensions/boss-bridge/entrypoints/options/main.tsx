import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles/ui.css'
import { OptionsApp } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('options root 不存在')
createRoot(container).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
)
