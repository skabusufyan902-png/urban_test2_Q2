(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const f2 = n => Number(n).toFixed(2);
const f1 = n => Number(n).toFixed(1);
const sg = (n, d = 2) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d);

const CLASS_COLORS = {
  'Water': '#419BDF', 'Trees': '#397D49', 'Grass': '#88B053', 'Flooded veg.': '#7A87C6', 'Crops': '#E49635',
  'Shrub & scrub': '#DFC35A', 'Built': '#C4281B', 'Bare': '#A59B8F', 'Snow/ice': '#B39FE1'
};
// colours must match export_for_github.py
const CHANGE_LAYERS = [
  { id: 'built_gain', label: 'Built gain', color: '#E31A1C' },
  { id: 'built_loss', label: 'Built loss', color: '#6A3D9A' },
  { id: 'tree_gain',  label: 'Tree gain',  color: '#7CFC00' },
  { id: 'tree_loss',  label: 'Tree loss',  color: '#FF8C00' }
];

function showError(msg) {
  const e = $('#error');
  e.hidden = false;
  e.innerHTML = msg;
}

async function load() {
  let stats, boundary;
  try {
    [stats, boundary] = await Promise.all([
      fetch('stats.json').then(r => { if (!r.ok) throw new Error('stats.json'); return r.json(); }),
      fetch('boundary.geojson').then(r => { if (!r.ok) throw new Error('boundary.geojson'); return r.json(); })
    ]);
  } catch (err) {
    showError('<b>Data files not found.</b> This page needs <code>stats.json</code> and <code>boundary.geojson</code>, ' +
      'created by the export cell in the notebook. If you opened <code>index.html</code> by double-clicking it, run ' +
      '<code>python -m http.server</code> in this folder and open <code>http://localhost:8000</code> instead.');
    console.error(err);
    return;
  }
  try { init(stats, boundary); }
  catch (err) { showError('<b>Page error:</b> ' + String(err && err.message || err)); console.error(err); }
}

function init(stats, boundary) {
  const years = stats.years.map(Number);
  const y0 = years[0], y1 = years[years.length - 1];
  const bounds = L.latLngBounds(stats.bounds);
  const app = $('#app');

  /* ---------- map ---------- */
  const map = L.map('map', { zoomControl: false, minZoom: 9, maxZoom: 18, zoomSnap: 0.25, attributionControl: true });
  const wide = window.innerWidth > 720;
  map.fitBounds(bounds, { paddingTopLeft: [wide ? 260 : 20, 70], paddingBottomRight: [20, 40] });

  const bases = {
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri' })
  };
  let baseKey = 'street';
  bases.street.addTo(map);

  [['years', 450], ['change', 460], ['boundary', 470]].forEach(([n, z]) => { map.createPane(n).style.zIndex = z; });

  let opacity = 0.9;
  const yearLayers = {};
  years.forEach(y => {
    yearLayers[y] = L.imageOverlay(`lc_${y}.png`, bounds, { pane: 'years', opacity, alt: `Land cover ${y}`, interactive: false });
  });
  const changeLayers = {};
  CHANGE_LAYERS.forEach(c => {
    changeLayers[c.id] = L.imageOverlay(`change_${c.id}.png`, bounds, { pane: 'change', opacity, alt: c.label, interactive: false });
  });
  const boundaryLayer = L.geoJSON(boundary, {
    pane: 'boundary', interactive: false,
    style: { color: '#000', weight: 2.5, fill: false, opacity: 1 }
  }).addTo(map);

  /* ---------- controls: zoom, legend, scale, north arrow ---------- */
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const present = Object.keys(CLASS_COLORS).filter(k => years.some(y => (stats.area[y][k] || 0) > 0));
  const LegendCtl = L.Control.extend({
    onAdd() {
      const c = L.DomUtil.create('div', 'legend-ctl');
      c.innerHTML =
        '<div class="leg-card" id="legCard" hidden>' +
        '<h3>Land cover (Dynamic World, 10 m)</h3>' +
        present.map(k => `<div class="it"><span class="sw" style="background:${CLASS_COLORS[k]}"></span>${k}</div>`).join('') +
        `<hr><h3>Change ${y0}→${y1}</h3>` +
        CHANGE_LAYERS.map(l => `<div class="it"><span class="sw" style="background:${l.color}"></span>${l.label}</div>`).join('') +
        '<hr><div class="it"><span class="sw line"></span>City boundary</div>' +
        '</div>' +
        '<button class="leg-btn" id="legBtn" type="button" aria-expanded="false" title="Legend" aria-label="Legend">Key</button>';
      L.DomEvent.disableClickPropagation(c);
      L.DomEvent.disableScrollPropagation(c);
      $('#legBtn', c).addEventListener('click', () => {
        const card = $('#legCard', c), open = card.hidden;
        card.hidden = !open;
        $('#legBtn', c).setAttribute('aria-expanded', String(open));
      });
      return c;
    }
  });
  new LegendCtl({ position: 'bottomright' }).addTo(map);

  // bottom-centre corner for the scale bar (as in the sketch)
  map._controlCorners.bottomcenter = L.DomUtil.create('div', 'leaflet-bottom leaflet-center', map._controlContainer);
  L.control.scale({ position: 'bottomcenter', metric: true, imperial: false, maxWidth: 160 }).addTo(map);

  const NorthCtl = L.Control.extend({
    onAdd() {
      const c = L.DomUtil.create('div', 'north');
      c.setAttribute('aria-label', 'North arrow');
      c.innerHTML =
        '<svg viewBox="0 0 64 64" role="img" aria-label="Compass: north is up">' +
        '<g stroke="currentColor" stroke-width="2" fill="none" style="color:var(--ink)">' +
        '<line x1="32" y1="14" x2="32" y2="52"/><line x1="16" y1="33" x2="48" y2="33"/>' +
        '<polyline points="26,22 32,13 38,22" fill="currentColor"/></g>' +
        '<text x="40" y="12">N</text><text x="2" y="37">W</text><text x="51" y="37">E</text><text x="28" y="63">S</text></svg>';
      return c;
    }
  });
  new NorthCtl({ position: 'topright' }).addTo(map);

  /* ---------- left panel ---------- */
  $('#changeSpan').textContent = `${y0}→${y1}`;
  const yl = $('#yearList');
  years.forEach(y => {
    const li = document.createElement('li');
    li.innerHTML = `<label class="check"><input type="checkbox" value="${y}"><span>${y}</span><small>${(stats.scenes || {})[y] ?? ''} scenes</small></label>`;
    yl.appendChild(li);
  });
  const cl = $('#changeList');
  CHANGE_LAYERS.forEach(c => {
    const li = document.createElement('li');
    li.innerHTML = `<label class="check"><input type="checkbox" value="${c.id}"><span class="sw" style="background:${c.color}"></span><span>${c.label}</span></label>`;
    cl.appendChild(li);
  });

  if (!wide) { app.classList.remove('menu-open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); }  // phones start with the map clear
  $('#menuBtn').addEventListener('click', () => {
    const open = app.classList.toggle('menu-open');
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  });

  /* ---------- year selection (max two -> swipe) ---------- */
  let selected = [];
  let playing = null;
  const yearBox = y => $(`#yearList input[value="${y}"]`);

  function setSelected(arr) {
    selected = arr.slice(-2);
    years.forEach(y => {
      const on = selected.includes(y), l = yearLayers[y];
      yearBox(y).checked = on;
      if (on && !map.hasLayer(l)) l.addTo(map);
      if (!on && map.hasLayer(l)) { const e = l.getElement(); if (e) e.style.clipPath = ''; map.removeLayer(l); }
    });
    const two = selected.length === 2;
    $('#swipe').hidden = !two;
    const sorted = [...selected].sort((a, b) => a - b);
    if (two) { $('#swipeL').textContent = sorted[0]; $('#swipeR').textContent = sorted[1]; }
    $('#yearBadge').textContent = selected.length === 1 ? selected[0] : (two ? `${sorted[0]} | ${sorted[1]}` : '');
    if (two) startClipLoop(); else { swipeActive = false; }
  }

  yl.addEventListener('change', e => {
    if (!e.target.matches('input')) return;
    stopPlay();
    const y = Number(e.target.value);
    setSelected(e.target.checked ? [...selected, y] : selected.filter(v => v !== y));
  });

  /* ---------- change layers ---------- */
  cl.addEventListener('change', e => {
    if (!e.target.matches('input')) return;
    const l = changeLayers[e.target.value];
    if (e.target.checked) l.addTo(map); else map.removeLayer(l);
  });

  /* ---------- boundary / basemap / opacity ---------- */
  $('#boundaryChk').addEventListener('change', e => {
    if (e.target.checked) boundaryLayer.addTo(map); else map.removeLayer(boundaryLayer);
  });
  document.querySelectorAll('input[name="base"]').forEach(r => r.addEventListener('change', e => {
    Object.values(bases).forEach(b => map.hasLayer(b) && map.removeLayer(b));
    baseKey = e.target.value;
    $('#map').classList.toggle('plain', baseKey === 'plain');
    if (bases[baseKey]) bases[baseKey].addTo(map);
  }));
  $('#opacity').addEventListener('input', e => {
    opacity = e.target.value / 100;
    Object.values(yearLayers).forEach(l => l.setOpacity(opacity));
    Object.values(changeLayers).forEach(l => l.setOpacity(opacity));
  });

  /* ---------- play ---------- */
  const playBtn = $('#playBtn');
  function stopPlay() {
    if (playing) { clearInterval(playing); playing = null; playBtn.textContent = '▶ Play'; }
  }
  playBtn.addEventListener('click', () => {
    if (playing) { stopPlay(); return; }
    let i = 0;
    setSelected([years[0]]);
    playBtn.textContent = '⏸ Pause';
    playing = setInterval(() => { i = (i + 1) % years.length; setSelected([years[i]]); }, 1300);
  });

  /* ---------- swipe divider ---------- */
  let frac = 0.5, swipeActive = false;
  const handle = $('#swipeHandle'), line = $('.swipe-line');
  function placeDivider() {
    line.style.left = (frac * 100) + '%';
    handle.style.left = (frac * 100) + '%';
    handle.setAttribute('aria-valuenow', Math.round(frac * 100));
  }
  function applyClip() {
    if (selected.length !== 2) return;
    const [a, b] = [...selected].sort((p, q) => p - q);
    const ea = yearLayers[a].getElement(), eb = yearLayers[b].getElement();
    if (!ea || !eb) return;
    const mr = map.getContainer().getBoundingClientRect();
    const dx = mr.left + mr.width * frac;
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
    const sa = (ra.width / (ea.offsetWidth || ra.width)) || 1, sb = (rb.width / (eb.offsetWidth || rb.width)) || 1;
    ea.style.clipPath = `inset(0 ${Math.max(0, (ra.right - dx) / sa)}px 0 0)`;
    eb.style.clipPath = `inset(0 0 0 ${Math.max(0, (dx - rb.left) / sb)}px)`;
  }
  function startClipLoop() {
    if (swipeActive) return;
    swipeActive = true;
    (function tick() { if (!swipeActive) return; applyClip(); requestAnimationFrame(tick); })();
  }
  function moveTo(clientX) {
    const mr = map.getContainer().getBoundingClientRect();
    frac = Math.min(0.98, Math.max(0.02, (clientX - mr.left) / mr.width));
    placeDivider();
  }
  handle.addEventListener('pointerdown', e => {
    handle.setPointerCapture(e.pointerId);
    const mv = ev => moveTo(ev.clientX);
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', mv);
    handle.addEventListener('pointerup', up);
    e.preventDefault();
  });
  handle.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      frac = Math.min(0.98, Math.max(0.02, frac + (e.key === 'ArrowLeft' ? -0.02 : 0.02)));
      placeDivider(); e.preventDefault();
    }
  });
  placeDivider();

  /* ---------- discussion + statistics ---------- */
  const drawer = $('#drawer');
  function setDrawer(open) {
    drawer.hidden = !open;
    app.classList.toggle('drawer-open', open);
    $('#discChk').checked = open;
    if (open && window.innerWidth <= 720) {          // phones: make room for the sheet
      app.classList.remove('menu-open');
      $('#menuBtn').setAttribute('aria-expanded', 'false');
      const card = document.getElementById('legCard');
      if (card) { card.hidden = true; $('#legBtn').setAttribute('aria-expanded', 'false'); }
    }
  }
  $('#discChk').addEventListener('change', e => setDrawer(e.target.checked));
  $('#drawerClose').addEventListener('click', () => setDrawer(false));
  try {
    $('#drawerBody').innerHTML = buildStatsHTML(stats, years);
    wireCharts($('#drawerBody'), stats, years);
  } catch (err) {
    $('#drawerBody').innerHTML = '<p class="flag"><b>Could not build the statistics:</b> ' + String(err.message) +
      '. Re-run the export cell so <code>stats.json</code> is complete.</p>';
    console.error(err);
  }

  // default view: first vs last year, so the change is visible straight away
  setSelected([y0, y1]);
}

/* ================= statistics + discussion text (all numbers come from data/stats.json) ================= */
function buildStatsHTML(S, years) {
  const A = S.area, y0 = years[0], y1 = years[years.length - 1], nY = y1 - y0;
  const city = S.meta.city_km2;
  const ser = c => years.map(y => A[y][c]);
  const bS = A[y0].Built, bE = A[y1].Built, tS = A[y0].Trees, tE = A[y1].Trees;
  const bArr = ser('Built'), tArr = ser('Trees');
  const bMax = Math.max(...bArr), tMax = Math.max(...tArr);
  const C = S.change, T = S.transitions, Z = S.zones;

  const hl = t => `<mark class="hl">${t}</mark>`;
  const cards =
    `<div class="cards">
      <div class="card b"><div class="k">Built-up</div><div class="v">${f1(bS)} → ${f1(bE)} km²</div>
        <div class="d">${sg(bE - bS)} km² (${sg((bE - bS) / bS * 100, 1)}%)<br>${f1(bS / city * 100)}% → ${f1(bE / city * 100)}% of city</div></div>
      <div class="card t"><div class="k">Tree cover</div><div class="v">${f1(tS)} → ${f1(tE)} km²</div>
        <div class="d">${sg(tE - tS)} km² (${sg((tE - tS) / tS * 100, 1)}%)<br>${f1(tS / city * 100)}% → ${f1(tE / city * 100)}% of city</div></div>
    </div>
    <p class="note">${y0} vs ${y1}, city boundary ${f1(city)} km², ${S.meta.resolution_m} m pixels, ${S.meta.season} composites.</p>`;

  let rows = '';
  years.forEach((y, i) => {
    const db = i ? bArr[i] - bArr[i - 1] : null, dt = i ? tArr[i] - tArr[i - 1] : null;
    rows += `<tr><td>${y}</td><td>${(S.scenes || {})[y] ?? '–'}</td>
      <td><span class="bar b" style="width:${bArr[i] / bMax * 46}px"></span>${f1(bArr[i])}</td><td>${db === null ? '–' : sg(db, 1)}</td>
      <td><span class="bar t" style="width:${tArr[i] / tMax * 46}px"></span>${f1(tArr[i])}</td><td>${dt === null ? '–' : sg(dt, 1)}</td></tr>`;
  });
  const yearTable =
    `<table class="st"><thead><tr><th>Year</th><th>Scenes</th><th>Built km²</th><th>Δ</th><th>Trees km²</th><th>Δ</th></tr></thead><tbody>${rows}</tbody></table>
     <p class="note">Δ = change from the previous year.</p>`;

  const gl =
    `<table class="st"><thead><tr><th>Class</th><th>Gain</th><th>Loss</th><th>Net</th></tr></thead><tbody>
      <tr><td>Built</td><td>${f2(C.built.gain)}</td><td>${f2(C.built.loss)}</td><td>${sg(C.built.gain - C.built.loss)}</td></tr>
      <tr><td>Trees</td><td>${f2(C.trees.gain)}</td><td>${f2(C.trees.loss)}</td><td>${sg(C.trees.gain - C.trees.loss)}</td></tr>
    </tbody></table>
    <p class="note">km², ${y0}→${y1}. Gain = the class in ${y1} but not in ${y0}. Gross gain and loss are larger than the net change because they happen in different places.</p>`;

  const barList = (obj, color, total) => {
    const e = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const m = Math.max(...e.map(x => x[1]), 1e-9);
    return '<ul class="lst">' + e.map(([k, v]) =>
      `<li><span>${k}</span><span class="tr"><i style="width:${v / m * 100}%;background:${color}"></i></span><span class="n">${f2(v)}</span></li>`).join('') + '</ul>';
  };
  const treesToBuilt = T.trees_to.Built || 0;
  const share = C.built.gain ? treesToBuilt / C.built.gain * 100 : 0;
  const trans =
    `<p><b>Where the ${y0} trees went</b> (km²)</p>${barList(T.trees_to, '#397D49')}
     <p><b>What became built-up</b> (km²)</p>${barList(T.to_built, '#C4281B')}
     <p class="note">${f2(treesToBuilt)} km² of ${y0} tree cover is built-up in ${y1}, which is ${f1(share)}% of all built gain.</p>`;

  // direction (quadrants around the city centroid)
  const q = Z.quadrants, qv = k => q[k] || { built_gain: 0, tree_loss: 0 };
  const qTotal = Object.values(q).reduce((s, v) => s + v.built_gain, 0) || 1;
  const cell = k => `<div><b>${k}</b><span class="big">${f2(qv(k).built_gain)}</span> km² built gain<br>${f2(qv(k).tree_loss)} km² tree loss</div>`;
  const compass = `<div class="compass">${cell('North-West')}${cell('North-East')}${cell('South-West')}${cell('South-East')}</div>
    <p class="note">Quarters are cut at the city centroid. North is up.</p>`;
  const ringRows = Object.entries(Z.rings).map(([k, v]) =>
    `<tr><td>${k}</td><td>${f1(v.area)}</td><td>${f1(v.built_2018 / v.area * 100)}% → ${f1(v.built_2025 / v.area * 100)}%</td><td>${f2(v.built_gain)}</td><td>${f2(v.tree_loss)}</td></tr>`).join('');
  const rings = `<table class="st"><thead><tr><th>Distance from centre</th><th>km²</th><th>Built share</th><th>Built gain</th><th>Tree loss</th></tr></thead><tbody>${ringRows}</tbody></table>`;

  /* ---- discussion text ---- */
  const qs = Object.entries(q).sort((a, b) => b[1].built_gain - a[1].built_gain);
  const qTop = qs[0], qLow = qs[qs.length - 1];
  const tl = Object.entries(q).sort((a, b) => b[1].tree_loss - a[1].tree_loss)[0];
  const rs = Object.entries(Z.rings), rGain = [...rs].sort((a, b) => b[1].built_gain - a[1].built_gain)[0];
  const spatial =
    `<p>Built-up land dominates the city: ${hl(f1(bE / city * 100) + '%')} of the ${f1(city)} km² boundary in ${y1}, against ${f1(tE / city * 100)}% for trees. ` +
    `Measured from the city centroid, the largest built-up gain is in the ${hl(qTop[0] + ' quarter')} (${hl(f2(qTop[1].built_gain) + ' km²')}, ${f1(qTop[1].built_gain / qTotal * 100)}% of all gain) ` +
    `and the smallest is in the ${qLow[0]} quarter (${f2(qLow[1].built_gain)} km²). The largest tree loss is in the ${hl(tl[0] + ' quarter')} (${f2(tl[1].tree_loss)} km²). ` +
    `By distance, the most built-up gain is in the ${hl(rGain[0] + ' zone')} (${f2(rGain[1].built_gain)} km²), where the built share moved from ` +
    `${f1(rGain[1].built_2018 / rGain[1].area * 100)}% to ${f1(rGain[1].built_2025 / rGain[1].area * 100)}%. ` +
    `Switch on the four change layers on the map to see exactly where these gains and losses sit.</p>`;

  const peakB = years[bArr.indexOf(bMax)], lowT = years[tArr.indexOf(Math.min(...tArr))];
  const diffs = arr => arr.slice(1).map((v, i) => v - arr[i]);
  const dB = diffs(bArr), dT = diffs(tArr);
  const lastIsOutlier = d => {
    if (d.length < 3) return false;
    const last = d[d.length - 1], prev = d[d.length - 2];
    const maxAbs = Math.max(...d.map(Math.abs));
    return Math.abs(last) === maxAbs && Math.sign(last) !== Math.sign(prev);
  };
  const flagged = [];
  if (lastIsOutlier(dB)) flagged.push(`Built ${sg(dB[dB.length - 1], 1)} km²`);
  if (lastIsOutlier(dT)) flagged.push(`Trees ${sg(dT[dT.length - 1], 1)} km²`);
  const flag = flagged.length
    ? `<div class="flag"><b>Check ${y1}.</b> ${flagged.join(' and ')} in ${y1} alone is the largest single-year change in the series and reverses the previous year’s direction. ` +
      `Changes this abrupt are more likely to come from the composite (a different set of clear scenes, or how green the vegetation was that winter) than from real land change, ` +
      `so the ${y0}→${y1} net figures for these classes should be read with caution.</div>` : '';
  const temporal =
    `<p>Between ${y0} and ${y1} built-up area ${bE >= bS ? 'increased' : 'decreased'} from ${f2(bS)} to ${f2(bE)} km² (${hl(sg(bE - bS) + ' km², ' + sg((bE - bS) / bS * 100, 1) + '%')}, ${sg((bE - bS) / nY)} km² per year). ` +
    `Tree cover ${tE >= tS ? 'increased' : 'decreased'} from ${f2(tS)} to ${f2(tE)} km² (${hl(sg(tE - tS) + ' km², ' + sg((tE - tS) / tS * 100, 1) + '%')}). ` +
    `Built-up area peaked in ${peakB} and tree cover was lowest in ${lowT}.</p>` + flag +
    `<p>Gross change is larger than net change: built-up land gained ${f2(C.built.gain)} km² and lost ${f2(C.built.loss)} km², while tree cover gained ${f2(C.trees.gain)} km² and lost ${f2(C.trees.loss)} km². ` +
    `${hl(f2(treesToBuilt) + ' km²')} of tree cover became built-up land (${hl(f1(share) + '% of built gain')}), and the other main source of built-up gain was ${
      Object.entries(T.to_built).filter(([k]) => k !== 'Trees').sort((a, b) => b[1] - a[1])[0][0].toLowerCase()} (${f2(Object.entries(T.to_built).filter(([k]) => k !== 'Trees').sort((a, b) => b[1] - a[1])[0][1])} km²).</p>`;

  const sc = Object.values(S.scenes || {}).map(Number);
  const scTxt = sc.length ? `${Math.min(...sc)} to ${Math.max(...sc)}` : 'varying numbers of';
  const limits =
    `<ul class="plain">
      <li><b>Spatial resolution.</b> ${S.meta.resolution_m} m pixels mix classes at edges, and small features such as street trees or narrow roads are not resolved.</li>
      <li><b>Temporal resolution.</b> One ${S.meta.season} composite per year, made from ${scTxt} scenes. Monsoon land cover and crop cycles are not captured, and year-to-year weather changes how green vegetation looks.</li>
      <li><b>Cloud and data availability.</b> Scenes with ${S.meta.cloud_max}% or more cloud (Sentinel-2 <code>CLOUDY_PIXEL_PERCENTAGE</code>) were removed. Thin cloud and haze can still affect the class probabilities.</li>
      <li><b>Dataset.</b> Dynamic World is a model prediction and is not checked here against ground data. Built and bare land can be confused, and so can trees, shrub and crops. Other products (ESA WorldCover, Landsat) will give different areas.</li>
      <li><b>Net change.</b> Gain and loss in different places can cancel, and small percentage changes may be within the classification error.</li>
    </ul>`;

  const keyList = [
    `${hl('Built-up ' + sg(bE - bS) + ' km² (' + sg((bE - bS) / bS * 100, 1) + '%)')} between ${y0} and ${y1}, now ${f1(bE / city * 100)}% of the city.`,
    `${hl('Tree cover ' + sg(tE - tS) + ' km² (' + sg((tE - tS) / tS * 100, 1) + '%)')}, but ${f2(C.trees.loss)} km² of trees were also lost.`,
    `${hl(f2(treesToBuilt) + ' km² of trees became built-up land')}, which is ${f1(share)}% of all built gain.`,
    `Most built-up gain: ${hl(qTop[0])} quarter (${f2(qTop[1].built_gain)} km²); most tree loss: ${hl(tl[0])} quarter.`
  ];
  if (flagged.length) keyList.push(`${hl('Check ' + y1)}: ${flagged.join(' and ')} in one year looks like a data effect, not real change.`);
  const keyBox = `<div class="key"><b>Key findings</b><ul>${keyList.map(k => `<li>${k}</li>`).join('')}</ul></div>`;

  return `
    <h3>At a glance</h3>${keyBox}${cards}
    <h3>Graphs</h3>${chartsHTML(S, years)}
    <h3>Year by year</h3>${yearTable}
    <h3>Gain and loss ${y0}→${y1}</h3>${gl}
    <h3>Transitions</h3>${trans}
    <h3>Direction: where the change happened</h3>${compass}${rings}
    <h3>Discussion</h3>
    <p><b>1. Spatial pattern</b></p>${spatial}
    <p><b>2. Temporal change</b></p>${temporal}
    <p><b>3. Limitations</b></p>${limits}
    <h3>Data</h3>
    <p class="links"><a href="stats.json" target="_blank" rel="noopener">stats.json</a>
    <a href="bhubaneswar_dynamicworld.gif" target="_blank" rel="noopener">Animated GIF</a></p>
    <p class="note">Source: Google Dynamic World V1 (GOOGLE/DYNAMICWORLD/V1), derived from Sentinel-2. Class = most likely class of the season-mean probabilities.</p>`;
}

/* ================= graphs (inline SVG; fixed light card so the validated colours always apply) ================= */
const CW = 400, CH = 200, CM = { l: 38, r: 50, t: 24, b: 24 };
const COL_B = '#C4281B', COL_T = '#397D49';

function chartsHTML(S, years) {
  const A = S.area, n = years.length;
  const bArr = years.map(y => A[y].Built), tArr = years.map(y => A[y].Trees);
  const iw = CW - CM.l - CM.r, ih = CH - CM.t - CM.b;

  /* --- chart 1: area by year (one axis, km2) --- */
  const ymax = Math.ceil(Math.max(...bArr, ...tArr) / 25) * 25;
  const X = i => CM.l + (n > 1 ? i * iw / (n - 1) : iw / 2), Y = v => CM.t + ih - v / ymax * ih;
  let g1 = '';
  for (let t = 0; t <= ymax; t += 25)
    g1 += `<line x1="${CM.l}" x2="${CM.l + iw}" y1="${Y(t)}" y2="${Y(t)}" stroke="#d9d5ca" stroke-width="1"/><text x="${CM.l - 6}" y="${Y(t) + 3}" text-anchor="end" class="ax">${t}</text>`;
  years.forEach((y, i) => { g1 += `<text x="${X(i)}" y="${CH - 7}" text-anchor="middle" class="ax">${y}</text>`; });
  const pl = (arr, c) => `<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" points="${arr.map((v, i) => X(i) + ',' + Y(v)).join(' ')}"/>`;
  const mk = i => `<circle cx="${X(i)}" cy="${Y(bArr[i])}" r="4" fill="${COL_B}" stroke="#fcfcfb" stroke-width="2"/>` +
                  `<rect x="${X(i) - 4}" y="${Y(tArr[i]) - 4}" width="8" height="8" fill="${COL_T}" stroke="#fcfcfb" stroke-width="2"/>`;
  const line =
    `<svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="Built-up and tree area by year, km2">${g1}
      <text x="${CM.l - 6}" y="10" text-anchor="end" class="ax u">km²</text>
      ${pl(bArr, COL_B)}${pl(tArr, COL_T)}${years.map((_, i) => mk(i)).join('')}
      <text x="${X(n - 1) + 9}" y="${Y(bArr[n - 1]) + 4}" class="lb">Built</text>
      <text x="${X(n - 1) + 9}" y="${Y(tArr[n - 1]) + 4}" class="lb">Trees</text>
      <line class="xh" x1="0" x2="0" y1="${CM.t}" y2="${CM.t + ih}" stroke="#55524c" stroke-width="1" visibility="hidden"/>
      <rect class="hit" x="${CM.l - 10}" y="${CM.t}" width="${iw + 20}" height="${ih}" fill="transparent"/></svg>`;

  /* --- chart 2: change vs previous year --- */
  const dB = bArr.slice(1).map((v, i) => v - bArr[i]), dT = tArr.slice(1).map((v, i) => v - tArr[i]);
  const dmax = Math.max(2, Math.ceil(Math.max(...dB.map(Math.abs), ...dT.map(Math.abs)) / 2) * 2);
  const Y2 = v => CM.t + ih / 2 - v / dmax * (ih / 2);
  const gw = iw / dB.length, bw = Math.min(10, gw / 3);
  let g2 = '';
  [-dmax, -dmax / 2, 0, dmax / 2, dmax].forEach(t => {
    g2 += `<line x1="${CM.l}" x2="${CM.l + iw}" y1="${Y2(t)}" y2="${Y2(t)}" stroke="${t === 0 ? '#55524c' : '#d9d5ca'}" stroke-width="1"/><text x="${CM.l - 6}" y="${Y2(t) + 3}" text-anchor="end" class="ax">${t > 0 ? '+' : ''}${t}</text>`;
  });
  const bar = (cx, v, c) => {
    const y0 = Y2(0), y1 = Y2(v), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
    return `<rect x="${cx}" y="${top}" width="${bw}" height="${h}" rx="2" fill="${c}"/>`;
  };
  let bars = '';
  dB.forEach((v, i) => {
    const cx = CM.l + gw * i + gw / 2;
    bars += bar(cx - bw - 1, dB[i], COL_B) + bar(cx + 1, dT[i], COL_T) +
      `<text x="${cx}" y="${CH - 7}" text-anchor="middle" class="ax">${years[i + 1]}</text>` +
      `<rect class="hit" data-i="${i}" x="${CM.l + gw * i}" y="${CM.t}" width="${gw}" height="${ih}" fill="transparent"/>`;
  });
  const bars2 = `<svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="Change in built-up and tree area versus the previous year, km2">${g2}
      <text x="${CM.l - 6}" y="10" text-anchor="end" class="ax u">Δ km²</text>${bars}</svg>`;

  const legend = `<div class="lg"><span><i class="c" style="background:${COL_B}"></i>Built-up</span><span><i class="s" style="background:${COL_T}"></i>Tree cover</span></div>`;
  return `<div class="chartbox" data-kind="line"><h4>Area by year</h4>${legend}${line}<div class="tip" hidden></div></div>
          <div class="chartbox" data-kind="bars"><h4>Change from the previous year</h4>${legend}${bars2}<div class="tip" hidden></div></div>
          <p class="note">Same data as the table below. Hover a chart for exact values.</p>`;
}

function wireCharts(root, S, years) {
  const A = S.area, n = years.length;
  const bArr = years.map(y => A[y].Built), tArr = years.map(y => A[y].Trees);
  const iw = CW - CM.l - CM.r;
  const dot = (c, sq) => `<i class="${sq ? 's' : 'c'}" style="background:${c}"></i>`;
  root.querySelectorAll('.chartbox').forEach(box => {
    const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), kind = box.dataset.kind;
    const show = (html, clientX, clientY) => {
      const r = box.getBoundingClientRect();
      tip.hidden = false; tip.innerHTML = html;
      let x = clientX - r.left + 12; if (x + tip.offsetWidth > r.width) x = clientX - r.left - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, clientY - r.top - 20) + 'px';
    };
    const hide = () => { tip.hidden = true; const xh = svg.querySelector('.xh'); if (xh) xh.setAttribute('visibility', 'hidden'); };
    if (kind === 'line') {
      const hit = svg.querySelector('.hit'), xh = svg.querySelector('.xh');
      hit.addEventListener('mousemove', e => {
        const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * CW;
        const i = Math.min(n - 1, Math.max(0, Math.round((vx - CM.l) / (iw / (n - 1)))));
        const px = CM.l + i * iw / (n - 1);
        xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
        show(`<b>${years[i]}</b><br>${dot(COL_B)}Built ${bArr[i].toFixed(1)} km²<br>${dot(COL_T, 1)}Trees ${tArr[i].toFixed(1)} km²`, e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', hide);
    } else {
      svg.querySelectorAll('.hit').forEach(h => {
        const i = +h.dataset.i;
        const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
        h.addEventListener('mousemove', e => show(`<b>${years[i + 1]}</b> vs ${years[i]}<br>${dot(COL_B)}Built ${sgn(bArr[i + 1] - bArr[i])} km²<br>${dot(COL_T, 1)}Trees ${sgn(tArr[i + 1] - tArr[i])} km²`, e.clientX, e.clientY));
        h.addEventListener('mouseleave', hide);
      });
    }
  });
}

load();
})();
