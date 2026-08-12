/**
 * MonsterMap — all three worldmap areas at once from baked PNGs.
 *
 * Usage: bun map.ts [--out DIR]
 *
 * Requires (all from bun lib/maps/bake.ts + bun gen.ts):
 *   out/maps/{surface,dungeon,extra}.png + layout.json
 *   out/data/monsters.json  itemspawns.json  resources.json
 *   out/data/locationnames.json  minimapicons.json
 *
 * Builds out/monstermap.html — a side panel + canvas that stacks the three
 * baked area PNGs vertically (no ocean gaps) and plots every point of interest
 * with a fixed color per category. Each category has an on/off toggle; a search
 * box builds a dropdown of matching element names and flashes those dots.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from './lib/config.ts';

const config = loadConfig();
const dataDir = config.dataDir;
const mapsDir = config.mapsDir;
const needed = [
    join(dataDir, 'monsters.json'),
    join(dataDir, 'itemspawns.json'),
    join(dataDir, 'resources.json'),
    join(dataDir, 'locationnames.json'),
    join(dataDir, 'minimapicons.json'),
    join(mapsDir, 'layout.json')
];
for (const p of needed) {
    if (!existsSync(p)) {
        throw new Error(`${p} missing — run bun gen.ts then bun lib/maps/bake.ts`);
    }
}

type AreaLayout = {
    name: string;
    ai: number;
    originX: number;
    originZ: number;
    w: number;
    h: number;
    png: string;
    wPx: number;
    hPx: number;
    tileX0: number;
    tileZTop: number;
    tileX1: number;
    tileZBot: number;
};

const monsters = JSON.parse(readFileSync(join(dataDir, 'monsters.json'), 'utf8'));
const items = JSON.parse(readFileSync(join(dataDir, 'itemspawns.json'), 'utf8'));
const res = JSON.parse(readFileSync(join(dataDir, 'resources.json'), 'utf8'));
const locs = JSON.parse(readFileSync(join(dataDir, 'locationnames.json'), 'utf8'));
const icons = JSON.parse(readFileSync(join(dataDir, 'minimapicons.json'), 'utf8'));
const layout = JSON.parse(readFileSync(join(mapsDir, 'layout.json'), 'utf8')) as AreaLayout[];

// --- build a unified point list (dots) + place labels (text)
const points: any[] = [];
for (const s of monsters.spawns) {
    const m = monsters.monsters[s.id];
    if (!m) continue;
    points.push({ x: s.x, z: s.z, level: s.level, cat: 'monster', name: m.name, sub: 'lvl ' + m.level, id: s.id });
}
for (const s of items.spawns) {
    points.push({ x: s.x, z: s.z, level: s.level, cat: 'item', name: s.name, sub: 'x' + s.count, id: s.id });
}
for (const s of res.spawns) {
    if (s.kind === 'mining') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'mining', name: s.group || s.name, sub: s.reqLevel ? 'rock lvl ' + s.reqLevel : 'rock', id: s.id });
    } else if (s.kind === 'woodcut') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'woodcut', name: s.group || s.name, sub: s.reqLevel ? 'tree lvl ' + s.reqLevel : 'tree', id: s.id });
    } else if (s.kind === 'fishing') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'fish', name: 'Fishing spot', sub: s.fish && s.fish.length ? s.fish.join(', ') : (s.category || ''), id: s.id });
    } else if (s.kind === 'flax') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'flax', name: s.name, sub: '', id: s.id });
    }
}
for (const s of icons.locations) {
    points.push({ x: s.x, z: s.z, level: s.level, cat: 'poi', name: s.icon || s.name, sub: s.name, id: s.id });
}
const labels = locs.places.map((p: any) => ({ x: p.x, z: p.z, level: 0, cat: 'place', name: p.name, lines: p.lines, type: p.type }));

// only what sits inside a baked area's trimmed tiles is visible
const inArea = (x: number, z: number): boolean =>
    layout.some(a => x >= a.tileX0 && x < a.tileX1 && z >= a.tileZBot && z <= a.tileZTop);
const pts = points.filter(p => inArea(p.x, p.z));
const lbls = labels.filter(p => inArea(p.x, p.z));
if (pts.length === 0 && lbls.length === 0) {
    throw new Error('no points overlap the baked area tiles');
}

// stacking
const stack = layout.map(a => ({ ...a }));
const stackHeight = stack.reduce((n, a) => n + a.hPx, 0);
const stackWidth = Math.max(...stack.map(a => a.wPx));
let acc = 0;
for (const a of stack) {
    a['yOff'] = acc;
    acc += a.hPx;
}
type StackArea = AreaLayout & { yOff: number };

// distinct names for the search dropdown
const nameSet = new Set<string>();
for (const p of pts) nameSet.add(p.name);
for (const l of lbls) nameSet.add(l.name);
const ALL_NAMES = [...nameSet].sort((a, b) => a.localeCompare(b));

const cats = [
    { key: 'monster', label: 'Monsters / NPCs', color: '#ffe14d' },
    { key: 'item', label: 'Item spawns', color: '#ff5b5b' },
    { key: 'mining', label: 'Mining rocks', color: '#9aa0a6' },
    { key: 'woodcut', label: 'Woodcut trees', color: '#54c265' },
    { key: 'fish', label: 'Fishing spots', color: '#4d8bff' },
    { key: 'flax', label: 'Flax', color: '#8fc1ff' },
    { key: 'poi', label: 'Map icons', color: '#36c5d0' },
    { key: 'place', label: 'Place names', color: '#e7e7e7' }
];
const colorOf: Record<string, string> = {};
for (const c of cats) colorOf[c.key] = c.color;

const html = render({ pts, lbls, stack, stackWidth, stackHeight, cats, colorOf, allNames: ALL_NAMES });
writeFileSync(join(config.outDir, 'monstermap.html'), html);
console.log(`wrote ${join(config.outDir, 'monstermap.html')} (${pts.length} dots, ${lbls.length} labels, ${stack.length} areas)`);

function render(payload: {
    pts: any[];
    lbls: any[];
    stack: StackArea[];
    stackWidth: number;
    stackHeight: number;
    cats: { key: string; label: string; color: string }[];
    colorOf: Record<string, string>;
    allNames: string[];
}): string {
    const json = JSON.stringify(payload);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MonsterMap</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0d1117;color:#e7e7e7;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;}
  #panel{display:flex;height:100vh;}
  #wrap{position:relative;flex:1;}
  #c{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;image-rendering:pixelated;}
  #side{position:relative;width:320px;padding:12px 14px;box-sizing:border-box;border-left:1px solid #232a31;overflow:auto;}
  h1{font-size:15px;margin:0 0 10px;}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8b96a3;margin:14px 0 6px;}
  label{display:block;margin:4px 0;}
  input[type=text]{width:100%;box-sizing:border-box;margin-top:3px;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:5px 7px;border-radius:4px;}
  .hint{color:#6b7683;font-size:11px;margin-top:5px;}
  .legend{display:grid;grid-template-columns:14px 1fr;gap:4px 9px;align-items:center;}
  .sw{width:14px;height:12px;border-radius:2px;border:1px solid rgba(255,255,255,.08);}
  .areas label{display:flex;align-items:center;gap:6px;margin:3px 0;}
  .areas .chip{display:inline-block;min-width:60px;padding:1px 6px;border-radius:3px;font-size:11px;color:#0d1117;text-align:center;}
  #tip{position:absolute;pointer-events:none;background:rgba(10,14,18,.94);border:1px solid #2f3b47;padding:9px 11px;border-radius:6px;max-width:360px;display:none;z-index:9;}
  #tip b{font-size:13px;}
  .r{display:flex;gap:8px;margin-top:4px;}
  .kv{color:#8b96a3;}
  #stats{position:absolute;left:12px;bottom:10px;background:rgba(18,22,27,.82);padding:5px 10px;border-radius:5px;font-size:12px;color:#aab6c2;}
  .area-label{position:absolute;left:4px;font-size:11px;color:#0d1117;background:rgba(231,238,247,.9);padding:1px 6px;border-radius:3px;pointer-events:none;opacity:.85;}
  #suggest{position:absolute;z-index:20;background:#161b22;border:1px solid #30363d;border-radius:4px;max-height:240px;overflow:auto;display:none;}
  #suggest div{padding:4px 8px;cursor:pointer;}
  #suggest div:hover,#suggest div.sel{background:#21303f;}
</style>
</head>
<body>
<div id="panel">
    <div id="wrap">
      <canvas id="c"></canvas>
      <div id="tip"></div>
      <div id="stats"></div>
    </div>
    <div id="side">
      <h1>MonsterMap</h1>
      <h2>Areas</h2>
      <div class="areas" id="areas"></div>
      <h2>Layers</h2>
      <div id="cats"></div>
      <h2>Find &amp; flash</h2>
      <input type="text" id="search" placeholder="name e.g. goblin, copper, Bank, Lumbridge" autocomplete="off">
      <div id="suggest"></div>
      <div class="hint">type to list matches; click one to make those dots flash</div>
      <div style="margin-top:16px;color:#8b96a3">drag: pan &middot; scroll: zoom &middot; hover: details</div>
    </div>
</div>
<script id="mmdata" type="application/json">${json}</script>
<script>
(function () {
"use strict";
var data = JSON.parse(document.getElementById("mmdata").textContent);
var pts = data.pts;
var lbls = data.lbls;
var stack = data.stack;
var stackW = data.stackWidth, stackH = data.stackHeight;
var cats = data.cats, colorOf = data.colorOf, ALL_NAMES = data.allNames;

var canvas = document.getElementById("c");
var ctx = canvas.getContext("2d");
var tip = document.getElementById("tip");
var statsEl = document.getElementById("stats");
var wrap = document.getElementById("wrap");
var dpr = window.devicePixelRatio || 1;
var W = 0, H = 0;

var imgs = {}, loaded = 0;
var shownAreas = {}, shownCats = {};
for (var i = 0; i < stack.length; i++) shownAreas[i] = true;
for (var ci = 0; ci < cats.length; ci++) shownCats[cats[ci].key] = true;

var ppt = 1, ox = 0, oy = 0;
var dragging = false, lastX = 0, lastY = 0;
var animId = 0, exactName = "";
var suggestEl = document.getElementById("suggest");
var suggestSel = -1;

function areaChipColor(ai) { return ["#7ea34a", "#a31628", "#e0a33a"][ai % 3] || "#54748c"; }
function spawnAreaIndex(x, z) {
  for (var i = 0; i < stack.length; i++) {
    var a = stack[i];
    if (x >= a.tileX0 && x < a.tileX1 && z >= a.tileZBot && z <= a.tileZTop) return i;
  }
  return -1;
}
function areaScreenX(a, x) { return ox + (x - a.tileX0) * ppt; }
function areaScreenY(a) { return oy + a.yOff * ppt; }

function fit() {
  ppt = Math.min((W - 24) / stackW, (H - 24) / stackH);
  if (!ppt || ppt < 0.02) ppt = 0.5;
  ox = (W - stackW * ppt) / 2;
  oy = (H - stackH * ppt) / 2;
}
function resize() {
  var r = wrap.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  requestDraw();
}
window.addEventListener("resize", resize);

function draw() {
  if (!W) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0a0e12";
  ctx.fillRect(0, 0, W, H);

  for (var i = 0; i < stack.length; i++) {
    if (!shownAreas[i]) continue;
    var a = stack[i], img = imgs[a.png];
    if (!img) continue;
    var dx = ox, dy = oy + a.yOff * ppt;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, a.wPx * ppt, a.hPx * ppt);
    ctx.fillStyle = areaChipColor(a.ai);
    ctx.font = "11px ui-monospace,monospace";
    ctx.textAlign = "left";
    var lbl = a.name + "  " + a.wPx + "x" + a.hPx;
    var tw = ctx.measureText(lbl).width;
    ctx.fillRect(dx + 2, dy + 2, tw + 8, 16);
    ctx.fillStyle = "#0d1117";
    ctx.fillText(lbl, dx + 6, dy + 14);
  }

  var dot = Math.max(2.2, Math.min(18, ppt * 0.9));
  var shown = 0, flashing = 0;
  var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);

  // dots
  for (var k = 0; k < pts.length; k++) {
    var p = pts[k];
    if (!shownCats[p.cat]) continue;
    var ai = spawnAreaIndex(p.x, p.z);
    if (ai < 0 || !shownAreas[ai]) continue;
    var a2 = stack[ai];
    var px = areaScreenX(a2, p.x), py = areaScreenY(a2) + (a2.tileZTop - p.z) * ppt;
    if (px < -40 || py < -40 || px > W + 40 || py > H + 40) continue;
    var is = exactName && p.name === exactName;
    if (is) {
      flashing++;
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,213,79," + (0.12 + 0.30 * pulse) + ")";
      ctx.arc(px, py, 12 + dot * 2 + (1 - pulse) * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = is ? 1 : (exactName ? 0.30 : 1);
    ctx.fillStyle = colorOf[p.cat] || "#ffffff";
    ctx.beginPath();
    ctx.arc(px, py, is ? dot + 3 : dot, 0, Math.PI * 2);
    ctx.fill();
    shown++;
  }
  ctx.globalAlpha = 1;

  // place labels (text)
  if (shownCats.place) {
    ctx.textAlign = "center";
    ctx.font = (Math.max(10, Math.min(20, ppt * 1.4)) | 0) + "px ui-monospace,monospace";
    for (var li = 0; li < lbls.length; li++) {
      var L = lbls[li];
      var lai = spawnAreaIndex(L.x, L.z);
      if (lai < 0 || !shownAreas[lai]) continue;
      var la = stack[lai];
      var lx = areaScreenX(la, L.x), ly = areaScreenY(la) + (la.tileZTop - L.z) * ppt;
      if (lx < -60 || ly < -30 || lx > W + 60 || ly > H + 30) continue;
      var lflash = exactName && (L.name === exactName || (L.lines && L.lines.indexOf(exactName) >= 0));
      if (lflash) flashing++;
      ctx.fillStyle = lflash ? "rgba(255,213,79," + (0.25 + 0.4 * pulse) + ")" : "rgba(10,14,18,0.72)";
      var txt = L.lines.join(" ");
      var w = ctx.measureText(txt).width;
      ctx.fillRect(lx - w / 2 - 3, ly - 9, w + 6, 16);
      ctx.fillStyle = lflash ? "#ffe14d" : "#e7e7e7";
      ctx.fillText(txt, lx, ly + 3);
    }
  }

  statsEl.textContent = shown + " dots" + (shownCats.place ? " + " + lbls.length + " labels" : "") +
    (exactName ? "  · flashing " + exactName : "") + "  (" + flashing + " flashing)";
}

var drawPending = false;
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(function () { drawPending = false; draw(); });
}
function tick() {
  if (!exactName) return;
  draw();
  animId = requestAnimationFrame(tick);
}

// ---- tooltip
function nearest(sx, sy) {
  var best = null, bestD = 26 * 26, bestLabel = false;
  for (var k = 0; k < pts.length; k++) {
    var p = pts[k];
    if (!shownCats[p.cat]) continue;
    var ai = spawnAreaIndex(p.x, p.z);
    if (ai < 0 || !shownAreas[ai]) continue;
    var a = stack[ai];
    var dx = areaScreenX(a, p.x) - sx, dy = (areaScreenY(a) + (a.tileZTop - p.z) * ppt) - sy;
    var d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; bestLabel = false; }
  }
  if (shownCats.place) {
    for (var li = 0; li < lbls.length; li++) {
      var L = lbls[li];
      var lai = spawnAreaIndex(L.x, L.z);
      if (lai < 0 || !shownAreas[lai]) continue;
      var la = stack[lai];
      var lx = areaScreenX(la, L.x), ly = areaScreenY(la) + (la.tileZTop - L.z) * ppt;
      var d2 = (lx - sx) * (lx - sx) + (ly - sy) * (ly - sy);
      if (d2 < bestD) { bestD = d2; best = L; bestLabel = true; }
    }
  }
  return best ? { el: best, isLabel: bestLabel } : null;
}
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
  if (c === "&") return "&amp;"; if (c === "<") return "&lt;"; if (c === ">") return "&gt;";
  if (c === '"') return "&quot;"; return "&#39;"; }); }
function showTip(hit) {
  if (!hit) { tip.style.display = "none"; return; }
  var e = hit.el;
  var html = "<b>" + esc(e.name) + "</b> <span class='kv'>#" + e.id + "</span>";
  if (e.cat && e.cat !== "place") html += " <span class='kv'>· " + esc(e.cat) + "</span>";
  if (e.sub) html += "<div class='r kv'>" + esc(e.sub) + "</div>";
  var ai = spawnAreaIndex(e.x, e.z);
  if (ai >= 0) html += "<div class='r kv'>" + esc(stack[ai].name) + " · tile " + e.x + "," + e.z + " (floor " + e.level + ")</div>";
  tip.innerHTML = html;
  tip.style.display = "block";
}
canvas.addEventListener("mousemove", function (e) {
  var r = wrap.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  if (dragging) { ox += mx - lastX; oy += my - lastY; lastX = mx; lastY = my; requestDraw(); return; }
  var hit = nearest(mx, my);
  tip.style.left = (mx + 14) + "px"; tip.style.top = (my + 14) + "px";
  if (hit) { showTip(hit); tip.style.display = "block"; } else { tip.style.display = "none"; }
});
canvas.addEventListener("mouseleave", function () { tip.style.display = "none"; });
canvas.addEventListener("mousedown", function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mouseup", function () { dragging = false; });
canvas.addEventListener("wheel", function (e) {
  e.preventDefault();
  var r = wrap.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  var spx = (mx - ox) / ppt, spy = (my - oy) / ppt;
  var factor = Math.exp(-e.deltaY * 0.002);
  var next = Math.min(64, Math.max(0.2, ppt * factor));
  ox = mx - spx * next; oy = my - spy * next; ppt = next;
  requestDraw();
}, { passive: false });

// ---- area + category toggles
function buildAreas() {
  var box = document.getElementById("areas");
  var h = "";
  for (var i = 0; i < stack.length; i++) {
    var a = stack[i];
    h += '<label><input type="checkbox" data-area="' + i + '" checked> <span class="chip" style="background:' + areaChipColor(a.ai) + '">' + esc(a.name) + '</span> ' + a.wPx + "x" + a.hPx + '</label>';
  }
  box.innerHTML = h;
  box.addEventListener("change", function (e) {
    var t = e.target; var i = Number(t.getAttribute("data-area"));
    shownAreas[i] = t.checked; requestDraw();
  });
}
function buildCats() {
  var box = document.getElementById("cats");
  var h = "";
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    h += '<label><input type="checkbox" data-cat="' + c.key + '" checked> <span class="sw" style="display:inline-block;background:' + c.color + '"></span> ' + esc(c.label) + '</label>';
  }
  box.innerHTML = h;
  box.addEventListener("change", function (e) {
    var t = e.target; var k = t.getAttribute("data-cat");
    if (!k) return;
    shownCats[k] = t.checked; requestDraw();
  });
}

// ---- search -> dropdown -> flash
function setExact(v) {
  exactName = v;
  if (exactName) { cancelAnimationFrame(animId); tick(); }
  else requestDraw();
}
function renderSuggest(q) {
  if (!q) { suggestEl.style.display = "none"; suggestSel = -1; return; }
  var lower = q.toLowerCase();
  var matches = [];
  for (var i = 0; i < ALL_NAMES.length; i++) {
    if (ALL_NAMES[i].toLowerCase().indexOf(lower) >= 0) matches.push(ALL_NAMES[i]);
    if (matches.length >= 200) break;
  }
  if (matches.length === 0) { suggestEl.style.display = "none"; return; }
  var h = "";
  for (var j = 0; j < matches.length; j++) h += '<div data-name="' + esc(matches[j]) + '">' + esc(matches[j]) + '</div>';
  suggestEl.innerHTML = h;
  suggestEl.style.display = "block";
  var input = document.getElementById("search");
  suggestEl.style.left = input.offsetLeft + "px";
  suggestEl.style.right = input.offsetLeft + "px";
  suggestEl.style.top = (input.offsetTop + input.offsetHeight + 4) + "px";
  suggestSel = -1;
  var items = suggestEl.querySelectorAll("div");
  for (var m = 0; m < items.length; m++) {
    items[m].addEventListener("click", function () {
      var nm = this.getAttribute("data-name");
      document.getElementById("search").value = nm;
      setExact(nm);
      suggestEl.style.display = "none";
    });
  }
}
document.getElementById("search").addEventListener("input", function () {
  renderSuggest(this.value.trim());
});
document.getElementById("search").addEventListener("keydown", function (e) {
  var items = suggestEl.querySelectorAll("div");
  if (e.key === "ArrowDown") { suggestSel = Math.min(items.length - 1, suggestSel + 1); }
  else if (e.key === "ArrowUp") { suggestSel = Math.max(0, suggestSel - 1); }
  else if (e.key === "Enter") {
    if (suggestSel >= 0 && items[suggestSel]) { var nm = items[suggestSel].getAttribute("data-name"); this.value = nm; setExact(nm); suggestEl.style.display = "none"; }
    else if (items[0]) { var nm2 = items[0].getAttribute("data-name"); this.value = nm2; setExact(nm2); suggestEl.style.display = "none"; }
    return;
  } else return;
  for (var i = 0; i < items.length; i++) items[i].classList.toggle("sel", i === suggestSel);
});

(function boot() {
  buildAreas();
  buildCats();
  resize();
  fit();
  loadImages();
  statsEl.textContent = "loading maps…";
})();

function loadImages() {
  for (var i = 0; i < stack.length; i++) {
    (function (a) {
      var img = new Image();
      img.onload = function () { loaded++; imgs[a.png] = img; if (loaded === stack.length) requestDraw(); };
      img.src = "maps/" + a.png;
    })(stack[i]);
  }
}
})();
</script>
</body>
</html>`;
}
