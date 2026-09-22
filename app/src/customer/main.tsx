import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LoaderCircle, SearchX } from 'lucide-react'
import '@/styles/app.css'
import { BUNDLED_REGISTRY, type Registry } from '@/core/registry'
import { getDesign, loadRegistry } from '@/core/backend'
import { PORTAL_NAME } from '@/core/app'
import { Toaster } from '@/ui/overlay'
import { Button, TipProvider } from '@/ui/primitives'
import { Portal } from './Portal'
import { Intake, Shell } from './Intake'
import { usePortal } from './store'

function App() {
  const id = new URLSearchParams(location.search).get('d')
  const [registry, setRegistry] = useState<Registry>(BUNDLED_REGISTRY)
  const record = usePortal(s => s.record), error = usePortal(s => s.error)
  const fetchIt = () => {
    if (!id) return
    usePortal.setState({ error: null })
    getDesign(id).then(r => usePortal.getState().load(id, r)).catch(e => usePortal.getState().fail(String(e?.message ?? e)))
  }
  useEffect(() => { loadRegistry().then(r => r && setRegistry(r)); fetchIt() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  let body
  if (!id) body = <Intake registry={registry} />
  else if (error) body = (
    <Shell>
      <div className="mx-auto max-w-md py-16 text-center" data-testid="not-found">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-surface-3 text-ink-3"><SearchX className="size-7" /></div>
        <h1 className="mt-5 text-[24px] font-semibold text-ink">We couldn’t open this design</h1>
        <p className="mt-2 text-[15px] text-ink-2">The link may be incomplete, or the design was withdrawn. Check the link in your email, or ask your engineer for a new one.</p>
        <Button className="mt-6" variant="secondary" onClick={fetchIt}>Try again</Button>
      </div>
    </Shell>
  )
  else if (!record) body = <div className="grid h-full place-items-center"><LoaderCircle className="size-6 animate-spin text-accent" /></div>
  else body = <Portal registry={registry} />
  return <TipProvider>{body}<Toaster /></TipProvider>
}

document.title = PORTAL_NAME
document.documentElement.classList.add('theme-portal')
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
