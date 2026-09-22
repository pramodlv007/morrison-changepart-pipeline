/**
 * End-to-end suite for Change-Part Studio (engineers) and Design Review (customers).
 *
 *   npm run build && python ../serve.py      # serves app/dist on :8765
 *   npm run e2e                              # from app/
 *
 * Drives real Chrome and asserts behaviour: live Stage 5 verdicts, prompt edits persisted
 * to sessionStorage, publish allowlist, the customer flow end to end, and layout at phone
 * width. LLM stages are exercised only with E2E_LLM=1 (they need a warm Ollama and minutes).
 * The hand-off store is backed up before the run and restored after.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.APP_URL || 'http://localhost:8765'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOTS = process.env.E2E_SHOTS || ''
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'store.json')
const backup = fs.existsSync(STORE) ? fs.readFileSync(STORE) : null

let passed = 0, failed = 0
const check = (name, ok, extra) => { ok ? passed++ : failed++; console.log(`${ok ? '  PASS' : '  FAIL'} ${name}${extra !== undefined ? `   -> ${extra}` : ''}`) }
const group = n => console.log(`\n${n}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = async (p, name, full = false) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full }) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'] })
const errors = []
async function open(url, w = 1440, h = 900) {
  const p = await browser.newPage()
  p.on('pageerror', e => errors.push(`${url}: ${e.message}`))
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_ABORTED/.test(m.text()) && !(url.includes('does-not-exist') && /404/.test(m.text()))) errors.push(`${url}: ${m.text()}`) })
  await p.setViewport({ width: w, height: h })
  await p.goto(BASE + url, { waitUntil: 'networkidle0' })
  await sleep(900)
  return p
}
const text = (p, sel) => p.$eval(sel, e => e.textContent.trim()).catch(() => null)
async function setField(p, sel, value) {
  await p.click(sel, { clickCount: 3 })
  await p.keyboard.press('Backspace')
  await p.type(sel, String(value))
  await p.keyboard.press('Enter')
  await sleep(250)
}
/** Real mouse click on the first element matching selector whose text contains t (Radix reacts to mousedown). */
async function clickText(p, selector, t) {
  const h = await p.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.trim().includes(t) && e.getClientRects().length) ?? null, selector, t)
  const el = h.asElement()
  if (!el) return false
  await el.click(); await sleep(150)
  return true
}

try {
  /* ===================== Studio ===================== */
  group('Studio · shell')
  const s = await open('/')
  await s.evaluate(() => sessionStorage.clear()); await s.reload({ waitUntil: 'networkidle0' }); await sleep(900)
  check('title is neutral', (await s.title()) === 'Change-Part Studio', await s.title())
  check('no company branding anywhere in the UI', !(await s.evaluate(() => /morrison/i.test(document.body.innerText))))
  check('all 9 stages in the rail', (await s.$$('[data-stage]')).length === 9)
  check('3D viewport mounted', !!(await s.$('[data-testid=viewer] canvas')))
  check('services reported', (await s.$$('[data-health]')).length === 3)
  await shot(s, 'studio-1440')

  group('Studio · live Stage 5 on the design panel')
  check('default starwheel is accepted (score 0.80)', /accept.*0\.80/i.test(await text(s, 'aside [data-testid=verdict]')), await text(s, 'aside [data-testid=verdict]'))
  await setField(s, '#in-pocket_clearance_mm', '0.35')
  check('clearance 0.35 → REJECT', /reject/i.test(await text(s, 'aside [data-testid=verdict]')))
  await s.click('[data-stage="5"]'); await sleep(200)
  await clickText(s, '[role=tab]', 'Output'); await sleep(300)
  check('scorecard shows the failing clearance check', await s.$eval('[data-check=clearance]', e => e.dataset.pass === 'false').catch(() => false))
  check('computed correction is shown', /pocket_clearance_mm must be MORE than 0\.5/.test(await s.evaluate(() => document.body.innerText)))
  await setField(s, '#in-pocket_clearance_mm', '0.8')
  check('restored → ACCEPT', /accept/i.test(await text(s, 'aside [data-testid=verdict]')))
  await s.click('[data-testid=run-stage]'); await sleep(1200)
  const notes = await s.evaluate(() => document.body.innerText)
  check('Validate records a run with the Python cross-check', /Python engine: ACCEPT — agrees/.test(notes) || /not reachable/.test(notes))

  group('Studio · part switching')
  await s.select('select[aria-label="Part type"]', 'feed_screw'); await sleep(600)
  check('feed screw sliders appear', !!(await s.$('#in-pitch_mm')) && !!(await s.$('#in-starts')))
  check('feed screw defaults accepted', /accept/i.test(await text(s, 'aside [data-testid=verdict]')))
  await setField(s, '#in-starts', '1')
  check('1 start at 380 cpm → REJECT (380 rpm > 350)', /reject/i.test(await text(s, 'aside [data-testid=verdict]')))
  await setField(s, '#in-starts', '2')
  await s.select('select[aria-label="Part type"]', 'guide_rail'); await sleep(600)
  check('guide rail defaults accepted', /accept/i.test(await text(s, 'aside [data-testid=verdict]')))
  await s.select('select[aria-label="Part type"]', 'starwheel'); await sleep(400)

  group('Studio · stage inspector')
  await s.click('[data-stage="1"]'); await sleep(200)
  await clickText(s, '[role=tab]', 'Prompt'); await sleep(300)
  check('prompt editor visible', !!(await s.$('[data-testid=prompt-editor]')))
  check('filled prompt has no unresolved variables', await s.evaluate(() => !/\{\{\w+\}\}/.test([...document.querySelectorAll('pre')].map(p => p.textContent).join(''))))
  await s.type('[data-testid=prompt-editor]', ' EXTRA-RULE')
  await sleep(200)
  check('edit is flagged', /Edited this session/.test(await s.evaluate(() => document.body.innerText)))
  await s.reload({ waitUntil: 'networkidle0' }); await sleep(900)
  await s.click('[data-stage="1"]'); await clickText(s, '[role=tab]', 'Prompt'); await sleep(300)
  check('prompt edit survives a reload (sessionStorage)', (await s.$eval('[data-testid=prompt-editor]', e => e.value)).includes('EXTRA-RULE'))
  await clickText(s, 'button', 'Reset to default'); await sleep(200)
  check('reset restores the default', !(await s.$eval('[data-testid=prompt-editor]', e => e.value)).includes('EXTRA-RULE'))
  await clickText(s, '[role=tab]', 'Input'); await sleep(200)
  check('Stage 1 input holds a sample email', (await s.$eval('[data-testid=email-input]', e => e.value.length)) > 50)
  await clickText(s, '[role=tab]', 'Model'); await sleep(200)
  check('model picker lists installed models', (await s.$$eval('select[aria-label=Model] option', o => o.length)) >= 1)
  await s.click('[data-stage="4"]'); await clickText(s, '[role=tab]', 'Input'); await sleep(200)
  check('Stage 4 input is the live design JSON', /"part_type": "starwheel"/.test(await s.evaluate(() => document.body.innerText)))
  await s.click('[data-stage="8"]'); await clickText(s, '[role=tab]', 'Output'); await sleep(200)
  check('Stage 8 is honest (no invented prediction)', /Offline model/.test(await s.evaluate(() => document.body.innerText)))

  group('Studio · viewer tools')
  await clickText(s, 'aside [role=radio]', 'Drawing'); await sleep(400)
  check('2D drawing renders', !!(await s.$('aside [data-testid=drawing] svg')))
  check('drawing is dimensioned', /PCD 620/.test(await s.$eval('aside [data-testid=drawing]', e => e.textContent)))
  await clickText(s, 'aside [role=radio]', '3D'); await sleep(300)
  await s.click('aside [aria-label="Exploded view"]'); await sleep(500)
  await s.click('aside [aria-label="Section view"]'); await sleep(300)
  check('section control appears', !!(await s.$('aside input[aria-label="Section plane position"]')))
  await s.click('aside [aria-label="Section view"]'); await s.click('aside [aria-label="Exploded view"]')

  group('Studio · command palette & CAD workspace')
  await s.keyboard.down('Control'); await s.keyboard.press('k'); await s.keyboard.up('Control'); await sleep(300)
  check('Ctrl+K opens the palette', !!(await s.$('[cmdk-input]')))
  await s.type('[cmdk-input]', 'CAD workspace'); await s.keyboard.press('Enter'); await sleep(700)
  check('CAD workspace with feature tree', !!(await s.$('nav[aria-label="Feature tree"]')))
  await shot(s, 'studio-cad')
  await clickText(s, 'nav[aria-label="Feature tree"] button', 'Pocket pattern'); await sleep(200)
  check('selecting a feature filters properties', !!(await s.$('#in-pocket_radius_mm')) && !(await s.$('#in-pcd_mm')))
  await clickText(s, '[role=radio]', 'Pipeline'); await sleep(500)

  group('Studio · publish (allowlist)')
  await s.click('[data-stage="6"]'); await clickText(s, '[role=tab]', 'Output'); await sleep(200)
  await s.click('[data-testid=publish]'); await sleep(1200)
  const link = await text(s, '[data-testid=customer-link]')
  check('customer link created', /\/customer\?d=/.test(link ?? ''), link)
  const id = link?.split('d=')[1]
  const rec = await s.evaluate(async id => (await fetch('/api/designs/' + id)).json(), id)
  const flat = JSON.stringify(rec.payload)
  check('payload carries no score, cost, tolerance or ranking', !/score|cost|toleran|rank|precedent|weighted/i.test(flat))

  /* ===================== Portal ===================== */
  group('Portal · review flow')
  const c = await open('/customer?d=' + id)
  check('portal is light themed', await c.evaluate(() => document.documentElement.classList.contains('theme-portal')))
  check('no engineering jargon on step 1', !(await c.evaluate(() => /Stage \d|verdict|PCD|cpm\b|Scorecard/.test(document.body.innerText))))
  check('status chip: all checks pass', /All checks pass/.test(await text(c, '[data-testid=status-chip]')))
  await shot(c, 'portal-requirements')
  await setField(c, 'input[aria-label="Line speed"]', '600')
  check('line speed above the machine rating → needs attention', /Needs attention/.test(await text(c, '[data-testid=status-chip]')))
  await setField(c, 'input[aria-label="Line speed"]', '380')
  check('back to 380 → passes', /All checks pass/.test(await text(c, '[data-testid=status-chip]')))
  await c.click('[data-testid=next]'); await sleep(1500)
  check('design step has the 3D viewer', !!(await c.$('[data-testid=viewer] canvas')))
  await setField(c, '#in-pocket_clearance_mm', '0.3')
  check('snug fit 0.3 → plain-language failure', /tightly|jam/i.test(await text(c, '[data-testid=live-status]')))
  await c.click('[aria-label^="Undo"]'); await sleep(300)
  check('undo restores a passing design', /Everything checks out/.test(await text(c, '[data-testid=live-status]')))
  await setField(c, '#in-wheel_thickness_mm', '24')
  check('a valid change is kept', /Everything checks out/.test(await text(c, '[data-testid=live-status]')))
  await shot(c, 'portal-design')
  await c.click('[data-testid=next]'); await sleep(600)
  check('checks step lists plain checks', (await c.$$('[data-testid=plain-checks] li')).length === 5)
  check('checks step shows the drawing', !!(await c.$('[data-testid=portal-drawing] svg')))
  await shot(c, 'portal-checks', true)
  await c.click('[data-testid=next]'); await sleep(500)
  await c.type('textarea[aria-label=Message]', 'Please make it 24 mm thick.')
  await shot(c, 'portal-approve')
  await c.click('[data-testid=approve]'); await sleep(1200)
  check('approval confirmed', !!(await c.$('[data-testid=done]')))
  const after = await c.evaluate(async id => (await fetch('/api/designs/' + id)).json(), id)
  const resp = after.responses.at(-1)
  check('response reaches the backend with the adjustment', resp?.kind === 'approve' && resp?.adjustments?.wheel_thickness_mm === 24, JSON.stringify(resp?.adjustments))

  group('Portal · phone width')
  const m = await open('/customer?d=' + id, 390, 844)
  await m.evaluate(() => sessionStorage.clear()); await m.reload({ waitUntil: 'networkidle0' }); await sleep(900)
  check('no horizontal scroll at 390px (requirements)', await m.evaluate(() => document.documentElement.scrollWidth <= 391))
  await shot(m, 'portal-390-requirements', true)
  await m.click('[data-testid=next]'); await sleep(1200)
  check('no horizontal scroll at 390px (design)', await m.evaluate(() => document.documentElement.scrollWidth <= 391))
  await shot(m, 'portal-390-design', true)

  group('Portal · intake & errors')
  const i = await open('/customer')
  check('intake form without a link', !!(await i.$('[data-testid=submit-request]')))
  await i.click('[data-part=feed_screw]')
  await i.type('input[type=email]', 'buyer@example.com')
  await i.type('textarea', 'Need a screw for the new 750 ml line.')
  await i.click('[data-testid=submit-request]'); await sleep(900)
  check('request submitted', !!(await i.$('[data-testid=intake-done]')))
  const reqs = await i.evaluate(async () => (await fetch('/api/requests')).json())
  check('request is in the engineers’ inbox', reqs.some(r => r.contact === 'buyer@example.com' && r.part_type === 'feed_screw'))
  const bad = await open('/customer?d=does-not-exist')
  check('unknown link shows a friendly error', !!(await bad.$('[data-testid=not-found]')))

  group('Studio · inbox')
  await s.bringToFront()
  await s.click('[aria-label="Customer inbox"]'); await sleep(900)
  check('inbox shows the new request', /buyer@example\.com/.test(await s.evaluate(() => document.body.innerText)))
  await clickText(s, 'button', 'Load into Stage 1'); await sleep(500)
  check('request loads into Stage 1 as an email', (await s.$eval('[data-testid=email-input]', e => e.value)).includes('buyer@example.com'))

  if (process.env.E2E_LLM) {
    group('Studio · real Ollama (E2E_LLM=1)')
    await s.select('select[aria-label="Part type"]', 'starwheel'); await sleep(300)
    await s.click('[data-stage="1"]'); await clickText(s, '[role=tab]', 'Input'); await sleep(200)
    await s.select('select[aria-label="Load a sample request"]', 'starwheel_cap16')
    await s.click('[data-testid=run-stage]'); await sleep(500)
    await s.waitForFunction(() => document.querySelector('[data-stage="1"] [aria-label=done], [data-stage="1"] [aria-label=failed]'), { timeout: 400000 })
    const out = await s.evaluate(() => document.body.innerText)
    check('Stage 1 produced a spec from local Ollama', /verbatim|not in email/.test(out), out.match(/Model not installed|Ollama not reachable|Output rejected.*/)?.[0])
    check('extracted 16 pockets and PCD 620', /pocket_count\s*16/.test(out) && /pcd_mm\s*620/.test(out))
  }

  group('Console')
  check('no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' | '))
} catch (e) {
  failed++
  console.log('  FAIL suite crashed -> ' + (e?.stack ?? e))
} finally {
  await browser.close()
  if (backup) fs.writeFileSync(STORE, backup)
  else if (fs.existsSync(STORE)) fs.unlinkSync(STORE)
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
