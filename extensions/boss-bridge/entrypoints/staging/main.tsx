import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles/ui.css'
import { StagingApp } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('staging root 不存在')
createRoot(container).render(
  <StrictMode>
    <StagingApp />
  </StrictMode>,
)
