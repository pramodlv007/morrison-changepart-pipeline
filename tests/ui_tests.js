/**
 * Browser regression suite for the change-part pipeline UI.
 *
 *   python serve.py          # in another terminal
 *   npm install puppeteer-core --no-save
 *   node tests/ui_tests.js
 *
 * Drives real Chrome against the served pages and asserts behaviour, not markup:
 * the deterministic validators, per-part geometry, cross-stage chaining, the
 * Stage 5 -> Stage 3/1 feedback loop, the customer page and its configurator,
 * and registry extensibility. LLM stages are not exercised here (they need a
 * warm Ollama and minutes per call) — stage5_engine is covered by pytest.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PIPELINE_URL || 'http://localhost:8765';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FIXTURE = path.join(__dirname, '..', 'parts', '_test_gripper.part.json');

let passed = 0, failed = 0;
const pass = (n, ok, extra) => {
  ok ? passed++ : failed++;
  console.log((ok ? '  PASS ' : '  FAIL ') + n + (extra !== undefined ? '   -> ' + extra : ''));
};
const group = n => console.log('\n' + n);

const FIXTURE_JSON = {
  part_types: {
    gripper: {
      label: 'Gripper Jaw',
      summary_for_customer: 'A sprung jaw that grips each container by its neck.',
      defaults: { jaw_opening_mm: 28, jaw_depth_mm: 40, thickness_mm: 14 },
      common_defaults: { bottle_diameter_mm: 28 },
      sliders: [{ k: 'jaw_opening_mm', l: 'Opening (mm)', min: 15, max: 60, step: 1 },
                { k: 'jaw_depth_mm', l: 'Depth (mm)', min: 20, max: 80, step: 1 }],
      customer_dimensions: [{ k: 'jaw_opening_mm', l: 'Neck opening', u: 'mm' }],
      branch_fields: ['jaw_opening_mm', 'jaw_depth_mm', 'thickness_mm', 'material_id'],
      cad_hint: 'Sketch the jaw profile and extrude by thickness_mm.',
      cad_checks: [{ pattern: 'import\\s+cadquery', flags: 'i', label: 'imports cadquery' }],
      sample_emails: { gripper_neck: { label: 'Gripper jaw - neck handling',
        text: 'From: test@example.com\nWe need a gripper jaw, 28mm neck opening, POM, CAP-16, 380 CPM.' } }
    }
  },
  precedents: [
    { id: 'GJ-40021', part_type: 'gripper', text: 'Gripper jaw, 28mm neck opening, POM, CAP-16, ran clean at 380 CPM.', outcome: 'clean' },
    { id: 'GJ-40044', part_type: 'gripper', text: 'Gripper jaw, 26mm opening on a 28mm neck, POM, CAP-16; marked necks and dropped containers.', outcome: 'jammed' }
  ]
};

const SW = { part_type: 'starwheel', pocket_count: 16, pcd_mm: 620, pocket_radius_mm: 32.8, pocket_clearance_mm: 0.8,
  machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6, bottle_diameter_mm: 54 };
const FS2 = { part_type: 'feed_screw', pitch_mm: 80, outer_diameter_mm: 140, root_diameter_mm: 90, length_mm: 480, starts: 2,
  flight_thickness_mm: 10, bottle_diameter_mm: 66, machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 };
const GR = { part_type: 'guide_rail', rail_radius_mm: 340, arc_angle_deg: 120, rail_height_mm: 25, thickness_mm: 12,
  contact_height_mm: 95, mating_pcd_mm: 620, bottle_diameter_mm: 54, bottle_height_mm: 210, machine_id: 'CAP-16',
  material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=swiftshader', '--no-sandbox'], protocolTimeout: 600000
  });
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', e => errors.push(tag + ' PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  };

  const dash = await browser.newPage();
  await dash.setViewport({ width: 1500, height: 950 });
  watch(dash, '[dash]');
  await dash.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2500));

  // ---------------------------------------------------------------- backend
  group('Backend + registry');
  const boot = await dash.evaluate(() => ({ regv: BACKEND.registryVersion, cq: BACKEND.cadquery,
    parts: Object.keys(PART_TYPES), precedents: PRECEDENTS.length, step: !document.getElementById('bstep').disabled }));
  pass('registry served to the dashboard', boot.regv === '2.0' && boot.parts.length === 3 && boot.precedents === 9, JSON.stringify(boot.parts));
  pass('STEP export offered when CadQuery present', boot.cq === boot.step, 'cadquery=' + boot.cq);

  const step = await dash.evaluate(async b => {
    const r = await fetch(b + '/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_type: 'guide_rail', params: { rail_radius_mm: 340, arc_angle_deg: 120, rail_height_mm: 25, thickness_mm: 12 } }) });
    const t = await r.text();
    return { ok: r.ok, head: t.slice(0, 13), len: t.length };
  }, BASE);
  pass('/api/step returns a real STEP solid', step.ok && step.head === 'ISO-10303-21;' && step.len > 10000,
    step.len + ' bytes, header ' + JSON.stringify(step.head));

  // ------------------------------------------------------------- validators
  group('Deterministic validators (browser mirror)');
  const v = await dash.evaluate(([sw, fs2, gr]) => {
    const one = d => { const r = validateDesign(d); return { v: r.verdict, c: r.computed, why: (r.reasons || [])[0] || '' }; };
    return { sw: one(sw), fs2: one(fs2), fs1: one({ ...fs2, starts: 1 }),
      gr: one(gr), grArc: one({ ...gr, arc_angle_deg: 200 }), steel: one({ ...sw, material_id: 'mild steel' }) };
  }, [SW, FS2, GR]);
  pass('starwheel reference accept', v.sw.v === 'accept' && v.sw.c.web === 55.36 && v.sw.c.ec === 0.5, 'web=' + v.sw.c.web);
  pass('feed screw 2-start accept', v.fs2.v === 'accept' && v.fs2.c.rpm === 190 && v.fs2.c.torque === 5.05, 'rpm=' + v.fs2.c.rpm);
  pass('feed screw 1-start rejected on drive rpm', v.fs1.v === 'reject' && /380 rpm/.test(v.fs1.why), v.fs1.why.slice(0, 48));
  pass('guide rail reference accept', v.gr.v === 'accept' && v.gr.c.gap === 3, 'gap=' + v.gr.c.gap);
  pass('guide rail 200 deg rejected', v.grArc.v === 'reject' && /180/.test(v.grArc.why), v.grArc.why.slice(0, 48));
  pass('non food-contact material rejected', v.steel.v === 'reject' && /food-contact/i.test(v.steel.why), v.steel.why.slice(0, 48));

  const cross = await dash.evaluate(async ([b, d]) => {
    const r = await fetch(b + '/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_type: d.part_type, params: d, ovality_mm: d.ovality_mm }) });
    return await r.json();
  }, [BASE, SW]);
  pass('Python engine agrees with the browser mirror', cross.verdict === 'accept' && cross.computed.web_thickness_mm === 55.36,
    'python web=' + cross.computed.web_thickness_mm);

  // --------------------------------------------------------- feedback loop
  group('Validation feedback loop');
  const fb = await dash.evaluate(([sw, fs2, gr]) => {
    const tight = validateDesign({ ...sw, pocket_clearance_mm: 0.35 });
    const steel = validateDesign({ ...sw, material_id: 'mild steel' });
    const fast = validateDesign({ ...sw, target_speed_cpm: 500 });
    return { geo: classifyFailure(tight).route, mat: classifyFailure(steel).route, spd: classifyFailure(fast).route,
      hintSW: repairHints(tight, { ...sw, pocket_clearance_mm: 0.35 }),
      hintFS: repairHints(validateDesign({ ...fs2, starts: 1, pitch_mm: 70 }), { ...fs2, starts: 1, pitch_mm: 70 }),
      hintGR: repairHints(validateDesign({ ...gr, rail_radius_mm: 349, arc_angle_deg: 200 }), { ...gr, rail_radius_mm: 349, arc_angle_deg: 200 }),
      packet: feedbackPacket(tight, { ...sw, pocket_clearance_mm: 0.35 }, 1) };
  }, [SW, FS2, GR]);
  pass('geometry failure routes to Stage 3', fb.geo === 'stage3', fb.geo);
  pass('material failure routes to Stage 1 (customer)', fb.mat === 'stage1', fb.mat);
  pass('overspeed routes to Stage 1 (customer)', fb.spd === 'stage1', fb.spd);
  pass('repair hint inverts the clearance formula', /MORE than 0.5/.test(fb.hintSW[0] || ''), (fb.hintSW[0] || '').slice(0, 64));
  pass('repair hint derives required screw starts', fb.hintFS.some(h => /starts must be AT LEAST 2/.test(h)), (fb.hintFS.find(h => /starts/.test(h)) || '').slice(0, 56));
  pass('repair hint bounds the rail radius and arc', fb.hintGR.some(h => /rail_radius_mm must be AT MOST/.test(h)) && fb.hintGR.some(h => /arc_angle_deg/.test(h)), fb.hintGR.length + ' hints');
  pass('packet carries failures, corrections and limits',
    /REJECTED/.test(fb.packet) && /REQUIRED CORRECTIONS/.test(fb.packet) && /Hard limits/.test(fb.packet), '');

  // ------------------------------------------------------- per-part viewer
  group('Viewer geometry and Stage 5 form');
  for (const t of ['starwheel', 'feed_screw', 'guide_rail']) {
    const s = await dash.evaluate(type => {
      sel(5); switchPartType(type);
      setView('2d'); const svg = document.querySelector('#dv svg');
      const chars = svg ? svg.innerHTML.length : 0; setView('3d');
      return { meshes: wg ? wg.children.length : 0, sliders: document.querySelectorAll('#cad-controls input').length,
        verdict: document.querySelector('#scout .vbadge').textContent.trim(), svg: chars };
    }, t);
    pass(t + ': 3D + 2D + form render', s.meshes > 0 && s.sliders > 0 && s.svg > 500 && /ACCEPT|REJECT/.test(s.verdict),
      'meshes=' + s.meshes + ' svg=' + s.svg);
  }
  const sync = await dash.evaluate(() => {
    switchPartType('feed_screw');
    const i = document.getElementById('cs_pitch_mm'); i.value = 60; i.dispatchEvent(new Event('input'));
    return { state: CAD_STATE.params.pitch_mm, form: document.getElementById('v_pitch_mm').value,
      verdict: document.querySelector('#scout .vbadge').textContent.trim() };
  });
  pass('viewer slider syncs the Stage 5 form and revalidates',
    sync.state === 60 && sync.form === '60' && /REJECT/.test(sync.verdict), JSON.stringify(sync));

  // ------------------------------------------------------------- chaining
  group('Cross-stage chaining');
  const chain = await dash.evaluate(() => {
    const spec = { part_type: 'guide_rail', machine_id: 'CAP-16', target_speed_cpm: 380, material_id: 'UHMW-PE',
      bottle_diameter_mm: 54, bottle_height_mm: 210, arc_angle_deg: 120, rail_height_mm: 25, thickness_mm: 12,
      contact_height_mm: 95, mating_pcd_mm: 620, rail_radius_mm: null };
    PIPELINE_STATE.spec = spec; PIPELINE_STATE.chosenBranch = null; applySpecToCad(spec);
    STAGE_INPUT_CACHE['o2-input'] = specSummaryText(spec);
    const picked = extractBranch(JSON.stringify({ branches: [{ branch_id: 'A', rail_radius_mm: 339 },
      { branch_id: 'B', rail_radius_mm: 341, arc_angle_deg: 110, recommended: true }, { branch_id: 'C', rail_radius_mm: 344 }] }));
    STAGE_INPUT_CACHE['o4-input'] = designParamsJSON(spec, picked);
    STAGE_INPUT_CACHE['o7-base'] = refinementBaseJSON(spec, picked);
    sel(2); const q = document.getElementById('o2-input').value;
    sel(4); const p4 = document.getElementById('o4-input').value.replace(/\s+/g, ' ');
    sel(7); const p7 = document.getElementById('o7-base').value.replace(/\s+/g, ' ');
    sel(1); loadSampleEmail('feed_screw'); sel(3); sel(1);
    return { label: document.getElementById('cad-type-lbl').textContent, q, picked: picked.branch_id, p4, p7,
      email: document.getElementById('o1-input').value.slice(0, 40) };
  });
  pass('spec switches the viewer part', chain.label === 'Guide Rail', chain.label);
  pass('Stage 2 query derived from the spec', /guide rail/.test(chain.q) && /120° arc/.test(chain.q), chain.q.slice(0, 52));
  pass('recommended branch selected', chain.picked === 'B', chain.picked);
  pass('Stage 4 + 7 inputs carry the branch', /"rail_radius_mm": 341/.test(chain.p4) && /"arc_angle_deg": 110/.test(chain.p7), '');
  pass('edited stage input survives navigation', /northridgebottling/.test(chain.email), chain.email.slice(0, 32));

  // ------------------------------------------------------- customer hand-off
  group('Customer page');
  await dash.evaluate(() => {
    switchPartType('starwheel');
    PIPELINE_STATE.spec = { part_type: 'starwheel', machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380,
      bottle_diameter_mm: 54, unresolved_questions: ['Can you confirm your container ovality?'] };
    localStorage.setItem('morrison_customer_payload', JSON.stringify(customerPayload()));
    localStorage.removeItem('morrison_customer_request'); localStorage.removeItem('morrison_customer_decision');
  });
  const leak = await dash.evaluate(() => {
    const p = customerPayload(), keys = new Set();
    (function walk(o) { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { keys.add(k); walk(o[k]); } })(p);
    return ['weighted_score', 'estimated_cost', 'cost_index', 'safety_factor', 'tolerance_mm', 'rank', 'ws'].filter(b => keys.has(b));
  });
  pass('hand-off leaks no internal engineering fields', leak.length === 0, leak.join(',') || 'clean');

  const cust = await browser.newPage();
  await cust.setViewport({ width: 1440, height: 1000 });
  watch(cust, '[customer]');
  await cust.goto(BASE + '/customer', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));

  const view = await cust.evaluate(() => ({
    glOK, meshes: root ? root.children.length : 0, hotspots: document.querySelectorAll('.hs').length,
    simple: document.querySelectorAll('#configure > .ctl input[type=range]').length,
    advSliders: document.querySelectorAll('.adv input[type=range]').length,
    advSelects: document.querySelectorAll('.adv select').length,
    advOpen: document.querySelector('.adv').open,
    swatches: document.querySelectorAll('.sw').length, checks: document.querySelectorAll('.checks li').length,
    steps: document.querySelectorAll('.steps li').length, questions: document.querySelectorAll('.qans').length,
    jargon: /weighted_score|cost_index|ISBT|21 CFR|cutThruAll|utilisation/i.test(document.body.innerText)
  }));
  pass('studio renders the part in 3D', view.glOK && view.meshes > 10, 'meshes=' + view.meshes);
  pass('hotspots placed on the model', view.hotspots === 3, 'n=' + view.hotspots);
  pass('simple configurator by default, advanced collapsed',
    view.simple === 2 && view.advOpen === false && view.advSliders >= 3 && view.advSelects === 2,
    JSON.stringify({ simple: view.simple, adv: view.advSliders, selects: view.advSelects }));
  pass('plain-language content, no jargon', view.checks >= 5 && view.steps === 7 && view.questions === 1 && !view.jargon, '');

  const hsVisible = await cust.evaluate(() => {
    const s = document.getElementById('studio').getBoundingClientRect();
    return [...document.querySelectorAll('.hs')].every(e => { const r = e.getBoundingClientRect();
      return r.y > s.y && r.y < s.y + s.height && r.x > s.x && r.x < s.x + s.width; });
  });
  pass('hotspots sit inside the viewport (not clipped)', hsVisible, '');

  group('Customer configurator');
  const cfg = await cust.evaluate(async () => {
    const out = {};
    setParam('pocket_clearance_mm', 1.2); await new Promise(r => setTimeout(r, 1500));
    out.safe = document.getElementById('verdict').className;
    setParam('pocket_clearance_mm', 0.35); await new Promise(r => setTimeout(r, 1500));
    out.unsafe = document.getElementById('verdict').className;
    out.unsafeText = document.getElementById('verdict').innerText.replace(/\n/g, ' ');
    document.querySelector('.adv').open = true;
    setParam('pcd_mm', 900); await new Promise(r => setTimeout(r, 1500));
    out.pcd = design().pcd_mm; out.readout = document.getElementById('readout').innerText.replace(/\n/g, ' ');
    setChoice('machine_id', 'CAP-12'); await new Promise(r => setTimeout(r, 1500));
    out.machine = design().machine_id; out.machineVerdict = document.getElementById('verdict').className;
    resetEdits(); await new Promise(r => setTimeout(r, 1200));
    out.afterReset = { edits: Object.keys(EDIT).length, pcd: design().pcd_mm, sel: document.getElementById('ch_machine_id').value };
    return out;
  });
  pass('safe change validates green via the Python engine', /ok/.test(cfg.safe), '');
  pass('unsafe change fails in plain words', /bad/.test(cfg.unsafe) && /gripped too tightly|problem/i.test(cfg.unsafeText), cfg.unsafeText.slice(0, 56));
  pass('advanced geometry slider drives the model', cfg.pcd === 900 && /900/.test(cfg.readout), 'pcd=' + cfg.pcd);
  pass('machine select revalidates against its rating', cfg.machine === 'CAP-12' && /bad/.test(cfg.machineVerdict), cfg.machine);
  pass('reset restores simple and advanced controls',
    cfg.afterReset.edits === 0 && cfg.afterReset.pcd === 620 && cfg.afterReset.sel === 'CAP-16', JSON.stringify(cfg.afterReset));

  const sent = await cust.evaluate(async () => {
    setParam('pocket_clearance_mm', 1.1); setChoice('machine_id', 'CAP-24');
    await new Promise(r => setTimeout(r, 900));
    document.querySelector('.qans').value = 'About 0.5 mm.';
    document.getElementById('reqtext').value = 'Please allow a little more room.';
    sendRequest(); await new Promise(r => setTimeout(r, 400));
    return JSON.parse(localStorage.getItem('morrison_customer_request') || 'null');
  });
  pass('request carries text, adjustments and answers',
    !!sent && sent.adjustments.pocket_clearance_mm === 1.1 && sent.adjustments.machine_id === 'CAP-24' && /0\.5 mm/.test(sent.text),
    JSON.stringify(sent && sent.adjustments));

  await dash.bringToFront();
  const inbox = await dash.evaluate(() => { checkCustomerInbox();
    const el = document.getElementById('inbox'); const shown = el.style.display !== 'none';
    applyCustomerRequest();
    return { shown, stage: cur, instr: (document.getElementById('o7-instr') || {}).value || '' }; });
  pass('engineering inbox receives it and loads Stage 7',
    inbox.shown && inbox.stage === 7 && /more room/.test(inbox.instr), inbox.instr.slice(0, 44));

  await cust.setViewport({ width: 390, height: 844, isMobile: true });
  await new Promise(r => setTimeout(r, 900));
  const overflow = await cust.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  pass('no horizontal overflow on mobile', overflow <= 2, overflow + 'px');

  // ------------------------------------------------------- extensibility
  group('Registry extensibility (drop-in part file)');
  fs.writeFileSync(FIXTURE, JSON.stringify(FIXTURE_JSON, null, 2));   // serve.py re-reads parts/ per request
  try {
    const ext = await browser.newPage();
    watch(ext, '[ext]');
    await ext.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2500));
    const r = await ext.evaluate(() => {
      sel(5); switchPartType('gripper');
      return { parts: Object.keys(PART_TYPES), precedents: PRECEDENTS.filter(p => p.part_type === 'gripper'),
        verdict: document.querySelector('#scout .vbadge').textContent.trim(),
        sliders: document.querySelectorAll('#cad-controls input').length,
        badge: document.getElementById('backend-badge').innerText,
        known: validateDesign({ part_type: 'starwheel', pocket_count: 16, pcd_mm: 620, pocket_radius_mm: 32.8,
          pocket_clearance_mm: 0.8, machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 }).verdict };
    });
    pass('new part type appears from its own file', r.parts.includes('gripper') && r.sliders === 2, r.parts.join(','));
    pass('its precedents join the retrieval corpus', r.precedents.length === 2 && r.precedents.some(p => p.outcome === 'jammed'), r.precedents.map(p => p.id).join(','));
    pass('part without physics reports UNVALIDATED, not a fake verdict', /UNVALIDATED/i.test(r.verdict), r.verdict);
    pass('extra part file reported in the UI', /\+1 part file/.test(r.badge), r.badge.split('\n')[0]);
    pass('existing parts unaffected', r.known === 'accept', r.known);
    await ext.close();
  } finally {
    fs.unlinkSync(FIXTURE);
  }

  console.log('\n' + '-'.repeat(64));
  console.log(`  ${passed} passed, ${failed} failed`);
  if (errors.length) { console.log('  console/page errors:'); errors.forEach(e => console.log('    ' + e)); }
  else console.log('  no console or page errors');
  console.log('-'.repeat(64));
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error(e); try { fs.unlinkSync(FIXTURE); } catch (_) {} process.exit(1); });
