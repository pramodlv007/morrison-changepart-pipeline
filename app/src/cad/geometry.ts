/**
 * Parametric part geometry (Three.js, Y-up, millimetres). Pure: design in, scene graph out.
 * This is a visual model for review — the manufacturing STEP comes from the validated
 * CadQuery builder in stage5_engine.py.
 */
import * as THREE from 'three'
import { num, type Design } from '@/core/validate'
import { isImplemented } from '@/core/registry'

export type Vec3 = [number, number, number]
export interface BuiltPart {
  group: THREE.Group
  anchors: Record<string, Vec3>
  extent: number               // bounding radius used to frame the camera
  kind: 'starwheel' | 'feed_screw' | 'guide_rail' | 'placeholder'
}

export const MATERIAL_TINT: Record<string, string> = {
  'UHMW-PE': '#e9eef6', POM: '#d5dde8', PTFE: '#f4f6f9', PEEK: '#cfb277',
  'mild steel': '#8c96a6', 'unpainted aluminum': '#b9c1cc', brass: '#c9a54a',
}
export const MATERIAL_BLURB: Record<string, string> = {
  'UHMW-PE': 'Self-lubricating, quiet, non-marking',
  POM: 'Stiff and dimensionally stable',
  PTFE: 'Lowest friction, chemical-proof',
  PEEK: 'Premium, high temperature',
}

function bodyMaterial(d: Design) {
  return new THREE.MeshStandardMaterial({ color: MATERIAL_TINT[String(d.material_id)] ?? '#dfe5ee', metalness: 0.06, roughness: 0.5, side: THREE.DoubleSide })
}
const steel = () => new THREE.MeshStandardMaterial({ color: '#7f899a', metalness: 0.75, roughness: 0.3 })
const ghostMat = () => new THREE.MeshStandardMaterial({ color: '#7fb4ff', transparent: true, opacity: 0.22, roughness: 0.2, depthWrite: false })
const edgeMat = (color = '#1b2233', opacity = 0.55) => new THREE.LineBasicMaterial({ color, transparent: true, opacity })

/** CAD-style silhouette edges — this is what makes a mesh read as an engineered part. */
function withEdges(mesh: THREE.Mesh, angle = 25, color?: string): THREE.Object3D {
  const g = new THREE.Group()
  g.add(mesh)
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), edgeMat(color))
  e.position.copy(mesh.position); e.rotation.copy(mesh.rotation); e.scale.copy(mesh.scale)
  e.userData.edge = true
  g.add(e)
  return g
}

function gridGeom(fn: (u: number, v: number) => Vec3, nu: number, nv: number) {
  const pos: number[] = [], idx: number[] = []
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pos.push(...fn(i / nu, j / nv))
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  return g
}

/* ---------------- starwheel ---------------- */
function starwheel(d: Design): BuiltPart {
  const pcd = num(d.pcd_mm, 620), n = Math.max(1, Math.round(num(d.pocket_count, 16))), r = num(d.pocket_radius_mm, 32.8)
  const th = num(d.wheel_thickness_mm, 20), rim = num(d.rim_mm, 8), bore = num(d.bore_diameter_mm, 50)
  const OD = pcd + 2 * r + 2 * rim, bd = num(d.bottle_diameter_mm, 54), bh = num(d.bottle_height_mm, 210)
  const g = new THREE.Group(), ghosts = new THREE.Group(); ghosts.name = 'ghosts'
  // Real holes: one extruded profile, bore and every pocket cut as Path holes.
  const prof = new THREE.Shape(); prof.absarc(0, 0, OD / 2, 0, Math.PI * 2, false)
  const bh0 = new THREE.Path(); bh0.absarc(0, 0, bore / 2, 0, Math.PI * 2, true); prof.holes.push(bh0)
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n, h = new THREE.Path()
    h.absarc((pcd / 2) * Math.cos(a), (pcd / 2) * Math.sin(a), r, 0, Math.PI * 2, true); prof.holes.push(h)
  }
  const disk = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: th, bevelEnabled: false, curveSegments: 48 }), bodyMaterial(d))
  disk.rotation.x = -Math.PI / 2; disk.position.y = -th / 2   // shape (x,y) → world (x, ·, −y); thickness spans y ∈ [−th/2, th/2]
  const body = withEdges(disk); body.name = 'body'; g.add(body)

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(bore / 2 + 18, bore / 2 + 18, th + 16, 48, 1, true), steel())
  const hubG = new THREE.Group(); hubG.add(hub); hubG.name = 'hub'; hubG.userData.explode = [0, -(th + 60), 0]
  g.add(hubG)

  for (let i = 0; i < n; i += Math.max(1, Math.round(n / 4))) {
    const a = 2 * Math.PI * i / n
    const b = new THREE.Mesh(new THREE.CylinderGeometry(bd / 2, bd / 2, bh * 0.55, 36), ghostMat())
    b.position.set((pcd / 2) * Math.cos(a), bh * 0.275 - th / 2 + 2, -(pcd / 2) * Math.sin(a)); ghosts.add(b)
  }
  ghosts.userData.explode = [0, bh * 0.7, 0]
  g.add(ghosts)
  return {
    group: g, extent: OD / 2, kind: 'starwheel',
    anchors: {
      pocket: [pcd / 2, th / 2, 0], bore: [0, th / 2 + 4, bore / 2 + 18],
      web: [(pcd / 2) * Math.cos(Math.PI / n), th / 2, -(pcd / 2) * Math.sin(Math.PI / n)],
    },
  }
}

/* ---------------- feed screw ---------------- */
function feedScrew(d: Design): BuiltPart {
  const od = num(d.outer_diameter_mm, 140), root = Math.min(num(d.root_diameter_mm, 90), od - 2), len = num(d.length_mm, 480)
  const pitch = Math.max(1, num(d.pitch_mm, 80)), ft = num(d.flight_thickness_mm, 10), starts = Math.max(1, Math.round(num(d.starts, 1)))
  const hand = String(d.handedness ?? 'RH').toUpperCase().startsWith('L') ? -1 : 1
  const g = new THREE.Group(), ghosts = new THREE.Group(); ghosts.name = 'ghosts'
  const core = new THREE.Mesh(new THREE.CylinderGeometry(root / 2, root / 2, len, 64, 1), steel()); core.rotation.z = Math.PI / 2
  const coreG = withEdges(core, 40, '#2a3244'); coreG.name = 'core'; g.add(coreG)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, len + 120, 32), steel()); shaft.rotation.z = Math.PI / 2
  const shaftG = new THREE.Group(); shaftG.add(shaft); shaftG.name = 'shaft'; shaftG.userData.explode = [0, -od * 0.9, 0]; g.add(shaftG)

  const lead = pitch * starts, turns = len / lead, nu = Math.max(40, Math.round(turns * 56))
  const X = (u: number) => -len / 2 + len * u, r0 = root / 2 - 1, r1 = od / 2, mat = bodyMaterial(d)
  for (let s = 0; s < starts; s++) {
    const off = 2 * Math.PI * s / starts, th = (u: number) => hand * 2 * Math.PI * turns * u + off
    const fl = new THREE.Group(); fl.name = `flight${s}`
    const face = (dx: number) => gridGeom((u, v) => { const rr = r0 + (r1 - r0) * v, a = th(u); return [X(u) + dx, rr * Math.cos(a), rr * Math.sin(a)] }, nu, 3)
    fl.add(new THREE.Mesh(face(ft / 2), mat), new THREE.Mesh(face(-ft / 2), mat))
    fl.add(new THREE.Mesh(gridGeom((u, w) => { const a = th(u); return [X(u) - ft / 2 + ft * w, r1 * Math.cos(a), r1 * Math.sin(a)] }, nu, 1), mat))
    // crest helix edge lines
    for (const dx of [-ft / 2, ft / 2]) {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= nu; i++) { const u = i / nu, a = th(u); pts.push(new THREE.Vector3(X(u) + dx, r1 * Math.cos(a), r1 * Math.sin(a))) }
      fl.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat()))
    }
    fl.userData.explode = [0, Math.cos(off) * od * 0.5, Math.sin(off) * od * 0.5]
    g.add(fl)
  }
  const bd = num(d.bottle_diameter_mm, 66), bh = num(d.bottle_height_mm, 210), nB = Math.floor(len / pitch)
  for (let k = 0; k < Math.min(nB, 7); k++) {
    const bx = -len / 2 + pitch * (k + 0.5)
    if (bx + bd / 2 > len / 2) break
    const b = new THREE.Mesh(new THREE.CylinderGeometry(bd / 2, bd / 2, bh * 0.8, 36), ghostMat())
    b.position.set(bx, 0, root / 2 + bd / 2 + 0.5); ghosts.add(b)
  }
  ghosts.userData.explode = [0, 0, od * 0.8]
  g.add(ghosts)
  return {
    group: g, extent: len / 2 + od / 2, kind: 'feed_screw',
    anchors: { flight: [0, od / 2, 0], pocket: [-len / 2 + pitch * 1.5, 0, root / 2 + bd / 2], root: [-len / 2 + len * 0.2, root / 2, 0] },
  }
}

/* ---------------- guide rail ---------------- */
function guideRail(d: Design): BuiltPart {
  const R = num(d.rail_radius_mm, 340), t = num(d.thickness_mm, 12), h = num(d.rail_height_mm, 25)
  const arc = num(d.arc_angle_deg, 120) * Math.PI / 180, pcd = num(d.mating_pcd_mm, 620)
  const bd = num(d.bottle_diameter_mm, 54), bh = num(d.bottle_height_mm, 210), ch = num(d.contact_height_mm, 95)
  const g = new THREE.Group(), ghosts = new THREE.Group(); ghosts.name = 'ghosts'
  // Rail centred on world +Z: shape angle −π/2 maps to world +Z after the −90° X rotation.
  const a0 = -Math.PI / 2 - arc / 2, a1 = -Math.PI / 2 + arc / 2, sh = new THREE.Shape()
  sh.absarc(0, 0, R, a0, a1, false); sh.absarc(0, 0, R + t, a1, a0, true)
  const rail = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 96 }), bodyMaterial(d))
  rail.rotation.x = -Math.PI / 2; rail.position.y = ch - h / 2
  const railG = withEdges(rail); railG.name = 'rail'; railG.userData.explode = [0, h * 3, 0]; g.add(railG)

  const wheelR = pcd / 2 + bd / 2 + 6
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 18, 96), new THREE.MeshStandardMaterial({ color: '#5b6b93', transparent: true, opacity: 0.18, depthWrite: false }))
  wheel.position.y = 9
  const wheelG = new THREE.Group(); wheelG.add(wheel); wheelG.name = 'wheel'; wheelG.userData.explode = [0, -h * 2.5, 0]; g.add(wheelG)

  const N = d.mating_pocket_count ? Math.max(1, Math.round(num(d.mating_pocket_count, 16))) : Math.max(1, Math.round(Math.PI * pcd / (2.2 * bd)))
  const nArc = Math.max(1, Math.round(arc / (2 * Math.PI) * N))
  for (let i = 0; i < nArc; i++) {
    const a = Math.PI / 2 + (i - (nArc - 1) / 2) * (2 * Math.PI / N)
    const b = new THREE.Mesh(new THREE.CylinderGeometry(bd / 2, bd / 2, bh, 36), ghostMat())
    b.position.set((pcd / 2) * Math.cos(a), bh / 2, (pcd / 2) * Math.sin(a)); ghosts.add(b)
  }
  g.add(ghosts)
  return {
    group: g, extent: Math.max(R + t, bh), kind: 'guide_rail',
    anchors: { rail: [0, ch + h / 2, R + t], pocket: [0, bh * 0.8, pcd / 2], wheel: [wheelR * 0.7, 18, wheelR * 0.4] },
  }
}

function placeholder(): BuiltPart {
  const g = new THREE.Group()
  const m = new THREE.Mesh(new THREE.BoxGeometry(200, 60, 120), new THREE.MeshStandardMaterial({ color: '#8f9bb3', transparent: true, opacity: 0.35 }))
  g.add(withEdges(m, 1, '#7c8bff'))
  return { group: g, anchors: {}, extent: 180, kind: 'placeholder' }
}

export function buildPart(d: Design): BuiltPart {
  if (!isImplemented(d.part_type)) return placeholder()
  if (d.part_type === 'feed_screw') return feedScrew(d)
  if (d.part_type === 'guide_rail') return guideRail(d)
  return starwheel(d)
}

/** Outline-only copy of a design, overlaid for before/after comparison. */
export function buildOutline(d: Design, color: string): THREE.Group {
  const out = new THREE.Group()
  buildPart(d).group.traverse(o => {
    if (o.parent?.name === 'ghosts' || o.name === 'ghosts') return
    if ((o as THREE.LineSegments).isLineSegments || (o as THREE.Line).isLine) {
      const l = (o as THREE.Line).clone()
      l.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
      o.updateWorldMatrix(true, false); l.applyMatrix4(o.matrixWorld)
      out.add(l)
    }
  })
  return out
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse(c => {
    const m = c as THREE.Mesh
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    mats.forEach(x => x.dispose())
  })
}

/* ---------------- direct-manipulation handles ---------------- */
export interface HandleDef {
  key: string
  label: string
  pos: Vec3
  plane: 'xz' | 'xy'             // drag plane (through pos)
  value: (p: THREE.Vector3) => number
  axis: Vec3                      // arrow direction, for the visual
}
export function handlesFor(d: Design, allowed?: string[]): HandleDef[] {
  const H: HandleDef[] = []
  const t = d.part_type
  if (t === 'starwheel') {
    const pcd = num(d.pcd_mm, 620), r = num(d.pocket_radius_mm, 32.8), th = num(d.wheel_thickness_mm, 20)
    H.push({ key: 'pocket_radius_mm', label: 'Pocket radius', pos: [pcd / 2 + r, th / 2 + 2, 0], plane: 'xz', axis: [1, 0, 0], value: p => p.x - pcd / 2 })
    H.push({ key: 'pcd_mm', label: 'Pitch circle', pos: [0, th / 2 + 2, -pcd / 2], plane: 'xz', axis: [0, 0, -1], value: p => 2 * Math.hypot(p.x, p.z) })
  } else if (t === 'feed_screw') {
    const len = num(d.length_mm, 480), od = num(d.outer_diameter_mm, 140), pitch = num(d.pitch_mm, 80)
    H.push({ key: 'length_mm', label: 'Length', pos: [len / 2 + 14, 0, 0], plane: 'xy', axis: [1, 0, 0], value: p => 2 * (p.x - 14) })
    H.push({ key: 'outer_diameter_mm', label: 'Outside diameter', pos: [0, od / 2 + 12, 0], plane: 'xy', axis: [0, 1, 0], value: p => 2 * (p.y - 12) })
    H.push({ key: 'pitch_mm', label: 'Pitch', pos: [-len / 2 + pitch, -od / 2 - 16, 0], plane: 'xy', axis: [1, 0, 0], value: p => p.x + len / 2 })
  } else if (t === 'guide_rail') {
    const R = num(d.rail_radius_mm, 340), t2 = num(d.thickness_mm, 12), arc = num(d.arc_angle_deg, 120) * Math.PI / 180
    const h = num(d.rail_height_mm, 25), ch = num(d.contact_height_mm, 95), y = ch + h / 2 + 4
    H.push({ key: 'rail_radius_mm', label: 'Rail radius', pos: [0, y, R], plane: 'xz', axis: [0, 0, 1], value: p => Math.hypot(p.x, p.z) })
    const ae = Math.PI / 2 + arc / 2
    H.push({ key: 'arc_angle_deg', label: 'Wrap angle', pos: [(R + t2 / 2) * Math.cos(ae), y, (R + t2 / 2) * Math.sin(ae)], plane: 'xz', axis: [-Math.sin(ae), 0, Math.cos(ae)],
      value: p => { let a = Math.atan2(p.z, p.x) - Math.PI / 2; if (a < -Math.PI) a += 2 * Math.PI; return Math.abs(a) * 2 * 180 / Math.PI } })
  }
  return allowed ? H.filter(h => allowed.includes(h.key)) : H
}
