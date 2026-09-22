/**
 * Interactive CAD viewport. One component serves both products; `tools` and `theme`
 * decide how much of the toolset is exposed (engineers get section/measure/dims,
 * customers get handles, compare and hotspots).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, GizmoHelper, GizmoViewcube, Grid, Html, OrbitControls } from '@react-three/drei'
import {
  Box, Boxes, Camera, Expand, GitCompareArrows, Grip, Info, Layers, Maximize2, Minimize2, Move3d, RotateCw, Ruler, Scissors, X,
} from 'lucide-react'
import type { Design } from '@/core/validate'
import type { Hotspot, SliderDef } from '@/core/registry'
import { roundToStep } from '@/core/safezone'
import { buildOutline, buildPart, disposeTree, handlesFor, type HandleDef, type Vec3 } from './geometry'
import { drawingSvg } from './drawing'
import { cn, IconButton, Segmented } from '@/ui/primitives'

export type Tool = 'rotate' | 'explode' | 'containers' | 'section' | 'measure' | 'handles' | 'compare' | 'hotspots' | 'screenshot' | 'fullscreen' | 'drawing' | 'dims'
type Preset = 'iso' | 'top' | 'front' | 'side'

export interface ViewerProps {
  design: Design
  label: string
  theme: 'studio' | 'portal'
  tools: Tool[]
  onParam?: (key: string, value: number) => void
  limits?: SliderDef[]                 // clamp + step for handle drags
  handleKeys?: string[]                // which handles are editable (default: all)
  compareTo?: Design | null            // original design for before/after
  hotspots?: Hotspot[]
  focusKey?: string | null             // highlight the handle of the slider being edited
  className?: string
  overlay?: ReactNode                  // chips rendered inside the viewport
  initial?: Partial<Record<'rotate' | 'containers' | 'handles' | 'dims', boolean>>
}

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

export function Viewer(p: ViewerProps) {
  const has = (t: Tool) => p.tools.includes(t)
  const host = useRef<HTMLDivElement>(null)
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const [gl] = useState(webglAvailable)
  const [mode, setMode] = useState<'3d' | '2d'>(gl ? '3d' : '2d')
  const [preset, setPreset] = useState<{ name: Preset; n: number }>({ name: 'iso', n: 0 })
  const [rotate, setRotate] = useState(p.initial?.rotate ?? false)
  const [explode, setExplode] = useState(false)
  const [containers, setContainers] = useState(p.initial?.containers ?? true)
  const [section, setSection] = useState(false)
  const [sectionAt, setSectionAt] = useState(0)
  const [measure, setMeasure] = useState(false)
  const [handles, setHandles] = useState(p.initial?.handles ?? has('handles'))
  const [dims, setDims] = useState(p.initial?.dims ?? false)
  const [compare, setCompare] = useState(false)
  const [full, setFull] = useState(false)
  const [openHot, setOpenHot] = useState<number | null>(null)
  const [interacted, setInteracted] = useState(false)

  // Re-frame whenever the part type changes.
  useEffect(() => setPreset(s => ({ name: 'iso', n: s.n + 1 })), [p.design.part_type])
  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === host.current)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])

  const shoot = () => {
    const c = glRef.current?.domElement
    if (!c) return
    const a = Object.assign(document.createElement('a'), { href: c.toDataURL('image/png'), download: `${p.design.part_type}.png` })
    document.body.appendChild(a); a.click(); a.remove()
  }
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else host.current?.requestFullscreen?.()
  }
  const svg = useMemo(() => mode === '2d' ? drawingSvg(p.design, p.label, p.theme, p.theme === 'portal' ? 'customer' : 'engineer') : '', [mode, p.design, p.label, p.theme])
  const glass = p.theme === 'studio'
    ? 'bg-[rgb(17_20_27/0.78)] border-border backdrop-blur-md'
    : 'bg-white/85 border-border backdrop-blur-md shadow-card'

  return (
    <div ref={host} className={cn('relative overflow-hidden bg-viewport select-none', full && 'rounded-none', p.className)} data-testid="viewer">
      {gl && (
        <Canvas className={cn('!absolute inset-0', mode === '2d' && 'invisible')} dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
          camera={{ fov: 36, near: 1, far: 50000, position: [700, 600, 800] }}
          onCreated={({ gl: r }) => { glRef.current = r; r.localClippingEnabled = true }}
          onPointerDown={() => setInteracted(true)}>
          <Suspense fallback={null}>
            <Scene {...p} preset={preset} rotate={rotate} explode={explode} containers={containers}
              section={section} sectionAt={sectionAt} measure={measure} handles={handles && has('handles')} dims={dims}
              compare={compare} openHot={openHot} setOpenHot={setOpenHot} />
          </Suspense>
        </Canvas>
      )}
      {mode === '2d' && (
        <div className="absolute inset-0 grid place-items-center p-6 pt-16" data-testid="drawing">
          <div className="h-full max-h-[640px] w-full max-w-[640px] [&>svg]:h-full [&>svg]:w-full rounded-xl overflow-hidden border border-border shadow-card" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute left-3 right-14 top-3 flex items-start gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          {has('drawing') && (
            <Segmented label="View mode" size="sm" value={mode} onChange={v => setMode(v)} className={glass}
              options={[{ value: '3d', label: '3D', icon: <Box className="size-3.5" /> }, { value: '2d', label: 'Drawing', icon: <Layers className="size-3.5" /> }]} />
          )}
          {mode === '3d' && (
            <Segmented label="Camera" size="sm" value={preset.name} onChange={v => setPreset(s => ({ name: v, n: s.n + 1 }))} className={glass}
              options={[{ value: 'iso', label: 'Iso' }, { value: 'top', label: 'Top' }, { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }]} />
          )}
        </div>
      </div>
      <div className="absolute right-3 top-3 bottom-3 flex flex-col items-end pointer-events-none">
        <div className={cn('flex flex-col items-center gap-0.5 rounded-xl border p-1 pointer-events-auto max-h-full overflow-y-auto', glass)} role="toolbar" aria-orientation="vertical" aria-label="Viewer tools">
          {mode === '3d' && <>
            {has('handles') && <IconButton size="sm" tipSide="left" label={handles ? 'Hide drag handles' : 'Show drag handles'} active={handles} onClick={() => setHandles(v => !v)}><Grip className="size-4" /></IconButton>}
            {has('rotate') && <IconButton size="sm" tipSide="left" label="Auto-rotate" active={rotate} onClick={() => setRotate(v => !v)}><RotateCw className="size-4" /></IconButton>}
            {has('explode') && <IconButton size="sm" tipSide="left" label="Exploded view" active={explode} onClick={() => setExplode(v => !v)}><Expand className="size-4" /></IconButton>}
            {has('containers') && <IconButton size="sm" tipSide="left" label="Show containers" active={containers} onClick={() => setContainers(v => !v)}><Boxes className="size-4" /></IconButton>}
            {has('dims') && <IconButton size="sm" tipSide="left" label="Dimension labels" active={dims} onClick={() => setDims(v => !v)}><Move3d className="size-4" /></IconButton>}
            {has('section') && <IconButton size="sm" tipSide="left" label="Section view" active={section} onClick={() => setSection(v => !v)}><Scissors className="size-4" /></IconButton>}
            {has('measure') && <IconButton size="sm" tipSide="left" label="Measure (click two points)" active={measure} onClick={() => setMeasure(v => !v)}><Ruler className="size-4" /></IconButton>}
            {has('compare') && p.compareTo && <IconButton size="sm" tipSide="left" label="Compare with original" active={compare} onClick={() => setCompare(v => !v)}><GitCompareArrows className="size-4" /></IconButton>}
            {has('screenshot') && <IconButton size="sm" tipSide="left" label="Save image" onClick={shoot}><Camera className="size-4" /></IconButton>}
          </>}
          {has('fullscreen') && <IconButton size="sm" tipSide="left" label={full ? 'Exit full screen' : 'Full screen'} onClick={toggleFull}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</IconButton>}
        </div>
      </div>

      {section && mode === '3d' && (
        <div className={cn('absolute left-3 top-14 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] text-ink-2', glass)}>
          <Scissors className="size-3.5" /> Section
          <input type="range" min={-1} max={1} step={0.01} value={sectionAt} onChange={e => setSectionAt(+e.target.value)} className="w-28 accent-[var(--accent)]" aria-label="Section plane position" />
        </div>
      )}
      {compare && mode === '3d' && (
        <div className={cn('absolute left-3 top-14 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] text-ink-2', glass)}>
          <span className="h-0.5 w-4 rounded bg-accent-2" /> Original outline
        </div>
      )}
      {measure && mode === '3d' && (
        <div className={cn('absolute left-1/2 top-14 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-[12px] text-ink-2', glass)}>Click two points on the part to measure</div>
      )}
      {!interacted && mode === '3d' && (
        <div className={cn('absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] text-ink-2 pointer-events-none', glass)}>
          <Info className="size-3.5" /> Drag to orbit · scroll to zoom{has('handles') ? ' · pull the handles to resize' : ''}
        </div>
      )}
      {p.overlay}
    </div>
  )
}

/* ================= scene ================= */
interface SceneProps extends ViewerProps {
  preset: { name: Preset; n: number }
  rotate: boolean; explode: boolean; containers: boolean; section: boolean; sectionAt: number
  measure: boolean; handles: boolean; dims: boolean; compare: boolean
  openHot: number | null; setOpenHot: (i: number | null) => void
}

function Scene(p: SceneProps) {
  const built = useMemo(() => buildPart(p.design), [p.design])
  useEffect(() => () => disposeTree(built.group), [built])
  const outline = useMemo(() => (p.compare && p.compareTo ? buildOutline(p.compareTo, p.theme === 'studio' ? '#a78bfa' : '#8b5cf6') : null), [p.compare, p.compareTo, p.theme])
  useEffect(() => () => { if (outline) disposeTree(outline) }, [outline])
  const floorY = useMemo(() => { const b = new THREE.Box3().setFromObject(built.group); return Number.isFinite(b.min.y) ? b.min.y - 2 : 0 }, [built])
  const { gl } = useThree()

  // Visibility of container ghosts.
  useEffect(() => { const g = built.group.getObjectByName('ghosts'); if (g) g.visible = p.containers }, [built, p.containers])

  // Section plane (global clipping) — cuts along Z so the camera looks into the section.
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), [])
  useEffect(() => { plane.constant = p.sectionAt * built.extent; gl.clippingPlanes = p.section ? [plane] : [] }, [p.section, p.sectionAt, built.extent, gl, plane])
  useEffect(() => () => { gl.clippingPlanes = [] }, [gl])

  // Exploded view: every child with userData.explode eases toward its offset.
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += ((p.explode ? 1 : 0) - t.current) * Math.min(1, dt * 7)
    built.group.children.forEach(c => {
      const ex = c.userData.explode as Vec3 | undefined
      if (!ex) return
      const base = (c.userData.base ??= c.position.clone()) as THREE.Vector3
      c.position.set(base.x + ex[0] * t.current, base.y + ex[1] * t.current, base.z + ex[2] * t.current)
    })
  })

  const studio = p.theme === 'studio'
  return (
    <>
      <hemisphereLight args={[studio ? '#c9d6ff' : '#ffffff', studio ? '#0b0d12' : '#dfe3ee', studio ? 0.75 : 1.0]} />
      <directionalLight position={[500, 900, 600]} intensity={studio ? 1.7 : 1.5} />
      <directionalLight position={[-600, 300, -400]} intensity={0.45} color={studio ? '#8fa2ff' : '#c7d2fe'} />
      <directionalLight position={[0, -400, 500]} intensity={0.25} />

      <primitive object={built.group} />
      {outline && <primitive object={outline} />}

      <Grid position={[0, floorY, 0]} args={[10, 10]} infiniteGrid fadeDistance={built.extent * 7} fadeStrength={2.2}
        cellSize={built.extent / 10} sectionSize={built.extent / 2} cellThickness={0.6} sectionThickness={1}
        cellColor={studio ? '#1c2233' : '#dde1ec'} sectionColor={studio ? '#2b3350' : '#c3c9da'} />
      <ContactShadows key={`${built.kind}-${Math.round(built.extent)}`} position={[0, floorY + 0.5, 0]} scale={built.extent * 3.2} far={built.extent} blur={2.4} opacity={studio ? 0.55 : 0.28} frames={1} />

      {p.measure && <Measure target={built.group} theme={p.theme} />}
      {(p.handles || p.dims) && <Handles design={p.design} onParam={p.onParam} limits={p.limits} keys={p.handleKeys} editable={p.handles && !!p.onParam} focusKey={p.focusKey ?? null} theme={p.theme} dims={p.dims} />}
      {p.tools.includes('hotspots') && !p.explode && p.hotspots?.map((h, i) => {
        const a = built.anchors[h.at]
        if (!a) return null
        return <HotspotPin key={i} n={i + 1} pos={a} h={h} open={p.openHot === i} onToggle={() => p.setOpenHot(p.openHot === i ? null : i)} theme={p.theme} />
      })}

      <CameraRig preset={p.preset} extent={built.extent} centerY={(floorY + built.extent * 0.1) * 0.5} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate={p.rotate} autoRotateSpeed={0.8} minDistance={built.extent * 0.3} maxDistance={built.extent * 12} />
      {p.theme === 'studio' && (
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewcube color="#1e2330" textColor="#e8ebf2" strokeColor="#323a50" hoverColor="#7c8bff" opacity={0.95} />
        </GizmoHelper>
      )}
    </>
  )
}

/* Animated camera presets + fit-to-part. */
function CameraRig({ preset, extent, centerY }: { preset: { name: Preset; n: number }; extent: number; centerY: number }) {
  const { camera, size, controls } = useThree() as any
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3; k: number } | null>(null)
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const d = (extent * 1.3) / Math.tan((cam.fov * Math.PI) / 360) / Math.min(1, aspect)
    const dirs: Record<Preset, Vec3> = { iso: [0.62, 0.55, 0.78], top: [0, 1, 0.0008], front: [0, 0.08, 1], side: [1, 0.08, 0] }
    const v = new THREE.Vector3(...dirs[preset.name]).normalize().multiplyScalar(d)
    const tgt = new THREE.Vector3(0, centerY, 0)
    anim.current = { from: cam.position.clone(), to: v.add(tgt), tf: controls?.target?.clone() ?? new THREE.Vector3(), tt: tgt, k: 0 }
  }, [preset.n]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const a = anim.current
    if (!a) return
    a.k = Math.min(1, a.k + dt / 0.65)
    const e = 1 - Math.pow(1 - a.k, 3)
    camera.position.lerpVectors(a.from, a.to, e)
    if (controls?.target) controls.target.lerpVectors(a.tf, a.tt, e)
    controls?.update?.()
    if (a.k >= 1) anim.current = null
  })
  return null
}

/* Drag handles: spheres the user pulls; the value comes from the drag plane intersection. */
function Handles({ design, onParam, limits, keys, editable, focusKey, theme, dims }:
  { design: Design; onParam?: (k: string, v: number) => void; limits?: SliderDef[]; keys?: string[]; editable: boolean; focusKey: string | null; theme: 'studio' | 'portal'; dims: boolean }) {
  const defs = useMemo(() => handlesFor(design, keys), [design, keys])
  const controls = useThree((s: any) => s.controls)
  const [drag, setDrag] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const size = useMemo(() => {
    const e = buildExtent(design)
    return Math.max(6, e * 0.03)
  }, [design])

  const onMove = useCallback((h: HandleDef, e: ThreeEvent<PointerEvent>) => {
    if (drag !== h.key || !onParam) return
    const plane = h.plane === 'xz' ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -h.pos[1]) : new THREE.Plane(new THREE.Vector3(0, 0, 1), -h.pos[2])
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(plane, hit)) return
    const lim = limits?.find(l => l.k === h.key)
    let v = h.value(hit)
    if (lim) v = Math.max(lim.min, Math.min(lim.max, v))
    v = roundToStep(v, lim?.step ?? 0.5, 0)
    if (Number.isFinite(v) && v !== design[h.key]) onParam(h.key, v)
  }, [drag, onParam, limits, design])

  const accent = theme === 'studio' ? '#7c8bff' : '#5046e5'
  const hot = theme === 'studio' ? '#2dd4bf' : '#06b6d4'
  return (
    <>
      {defs.map(h => {
        const active = drag === h.key || hover === h.key || focusKey === h.key
        const val = design[h.key]
        return (
          <group key={h.key} position={h.pos}>
            {editable && (
              <mesh
                onPointerOver={e => { e.stopPropagation(); setHover(h.key); document.body.style.cursor = 'grab' }}
                onPointerOut={() => { setHover(null); if (!drag) document.body.style.cursor = '' }}
                onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(h.key); if (controls) controls.enabled = false; document.body.style.cursor = 'grabbing' }}
                onPointerUp={e => { (e.target as Element).releasePointerCapture?.(e.pointerId); setDrag(null); if (controls) controls.enabled = true; document.body.style.cursor = '' }}
                onPointerMove={e => onMove(h, e)}
                scale={active ? 1.35 : 1}>
                <sphereGeometry args={[size, 24, 16]} />
                <meshStandardMaterial color={active ? hot : accent} emissive={active ? hot : accent} emissiveIntensity={0.45} roughness={0.35} depthTest={false} transparent />
              </mesh>
            )}
            {editable && <ArrowHint axis={h.axis} size={size} color={active ? hot : accent} />}
            {(active || dims) && <Html center position={[0, size * 2.6, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
              <div className={cn('whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium shadow-lg transition',
                theme === 'studio' ? 'bg-[#0b0d12]/90 text-[#e8ebf2] border border-[#323a50]' : 'bg-white text-[#0e1330] border border-[#e3e6ef]',
                active && 'ring-2 ring-[var(--accent-3)]')}>
                {h.label} <span className="opacity-60">·</span> {typeof val === 'number' ? +val.toFixed(2) : val}{h.key.endsWith('_deg') ? '°' : ' mm'}
              </div>
            </Html>}
          </group>
        )
      })}
    </>
  )
}
function buildExtent(d: Design): number {
  const n = (k: string, f: number) => (Number.isFinite(+d[k]) ? +d[k] : f)
  if (d.part_type === 'feed_screw') return n('length_mm', 480) / 2 + n('outer_diameter_mm', 140) / 2
  if (d.part_type === 'guide_rail') return n('rail_radius_mm', 340)
  return n('pcd_mm', 620) / 2 + n('pocket_radius_mm', 32)
}
function ArrowHint({ axis, size, color }: { axis: Vec3; size: number; color: string }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis).normalize()), [axis])
  const q2 = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis).normalize().negate()), [axis])
  return (
    <>
      {[q, q2].map((qq, i) => (
        <group key={i} quaternion={qq}>
          <mesh position={[0, size * 2.1, 0]}>
            <coneGeometry args={[size * 0.55, size * 1.1, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
          </mesh>
        </group>
      ))}
    </>
  )
}

/* Two-click measurement on the part surface. */
function Measure({ target, theme }: { target: THREE.Object3D; theme: 'studio' | 'portal' }) {
  const [pts, setPts] = useState<THREE.Vector3[]>([])
  const { camera, gl, raycaster, pointer } = useThree()
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObject(target, true).filter(h => (h.object as THREE.Mesh).isMesh && h.object.parent?.name !== 'ghosts' && h.object.visible)
      if (!hits.length) return
      setPts(prev => (prev.length >= 2 ? [hits[0].point.clone()] : [...prev, hits[0].point.clone()]))
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPts([]) }
    el.addEventListener('pointerdown', pd); el.addEventListener('pointerup', pu); window.addEventListener('keydown', key)
    return () => { el.removeEventListener('pointerdown', pd); el.removeEventListener('pointerup', pu); window.removeEventListener('keydown', key) }
  }, [camera, gl, raycaster, pointer, target])
  const color = theme === 'studio' ? '#fbbf24' : '#d97706'
  const line = useMemo(() => (pts.length === 2 ? new THREE.BufferGeometry().setFromPoints(pts) : null), [pts])
  return (
    <>
      {pts.map((q, i) => (
        <mesh key={i} position={q}><sphereGeometry args={[3, 16, 12]} /><meshBasicMaterial color={color} depthTest={false} transparent /></mesh>
      ))}
      {line && (
        <>
          <primitive object={new THREE.Line(line, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }))} />
          <Html center position={pts[0].clone().lerp(pts[1], 0.5)} style={{ pointerEvents: 'none' }}>
            <div className="rounded-md bg-[#fbbf24] px-2 py-0.5 font-mono text-[12px] font-semibold text-[#1b1400] shadow-lg" data-testid="measure-readout">
              {pts[0].distanceTo(pts[1]).toFixed(1)} mm
            </div>
          </Html>
        </>
      )}
    </>
  )
}

function HotspotPin({ n, pos, h, open, onToggle, theme }: { n: number; pos: Vec3; h: Hotspot; open: boolean; onToggle: () => void; theme: 'studio' | 'portal' }) {
  return (
    <Html position={pos} center zIndexRange={[30, 10]}>
      <div className="relative">
        <button onClick={onToggle} aria-label={h.title} aria-expanded={open}
          className={cn('grid size-7 place-items-center rounded-full text-[12px] font-bold text-white shadow-lg ring-4 transition hover:scale-110 cursor-pointer',
            open ? 'bg-accent-2 ring-[color-mix(in_srgb,var(--accent-2)_30%,transparent)]' : 'bg-accent ring-[color-mix(in_srgb,var(--accent)_28%,transparent)]')}>
          {n}
        </button>
        {open && (
          <div className={cn('absolute left-1/2 bottom-9 w-60 -translate-x-1/2 rounded-xl border p-3 text-left shadow-2xl animate-in',
            theme === 'studio' ? 'bg-surface border-border' : 'bg-white border-border')}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-[13px] font-semibold text-ink">{h.title}</div>
              <button onClick={onToggle} aria-label="Close" className="text-ink-3 hover:text-ink cursor-pointer"><X className="size-3.5" /></button>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{h.body}</p>
          </div>
        )}
      </div>
    </Html>
  )
}
