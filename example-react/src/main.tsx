import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PeerProvider } from './context/peer-context.tsx'
import { MediaProvider } from './context/media-context.tsx'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <PeerProvider>
    <MediaProvider>
      <App />
    </MediaProvider>
  </PeerProvider>
)
