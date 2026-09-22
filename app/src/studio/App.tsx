import { useEffect } from 'react'
import { TopBar } from './TopBar'
import { PipelineRail } from './PipelineRail'
import { Inspector } from './Inspector'
import { CadWorkspace, DesignPanel } from './DesignPanel'
import { refreshEnvironment } from './runner'
import { useStudio } from './store'
import { Toaster } from '@/ui/overlay'
import { TipProvider } from '@/ui/primitives'

export function App() {
  const view = useStudio(s => s.view)
  useEffect(() => {
    refreshEnvironment()
    const t = setInterval(refreshEnvironment, 30000)
    return () => clearInterval(t)
  }, [])
  return (
    <TipProvider>
      <div className="theme-studio flex h-full flex-col bg-bg text-ink">
        <TopBar />
        <main className="min-h-0 flex-1">
          {view === 'cad' ? <CadWorkspace /> : (
            <div className="grid h-full min-h-0 grid-cols-[248px_minmax(0,1fr)_minmax(380px,34%)] max-xl:grid-cols-[216px_minmax(0,1fr)_360px] max-lg:grid-cols-[64px_minmax(0,1fr)_340px]">
              <PipelineRail />
              <Inspector />
              <DesignPanel />
            </div>
          )}
        </main>
        <Toaster />
      </div>
    </TipProvider>
  )
}
