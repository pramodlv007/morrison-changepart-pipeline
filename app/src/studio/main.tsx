import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/app.css'
import { App } from './App'
import { APP_NAME } from '@/core/app'

document.title = APP_NAME
document.documentElement.classList.add('theme-studio')
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
