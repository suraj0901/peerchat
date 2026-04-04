import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PeerProvider } from './peer-context'
import { MediaProvider } from './media-context'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PeerProvider>
      <MediaProvider>
        <App />
      </MediaProvider>
    </PeerProvider>
  </StrictMode>,
)
