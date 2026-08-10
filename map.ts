/**
 * MonsterMap — all three worldmap areas at once from baked PNGs.
 *
 * Usage: bun map.ts [--out DIR]
 *
 * Requires:
 *   out/maps/{surface,dungeon,extra}.png + layout.json   (bun lib/maps/bake.ts)
 *   out/data/monsters.json                               (bun gen.ts)
 *
 * Builds out/monstermap.html — a side panel + canvas that stacks the three
 * baked area PNGs vertically (with no ocean gaps) and plots every spawn dot
 * using the layout's world-tile -> pixel mapping. No live MapView, no jag.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from './lib/config.ts';

const config = loadConfig();
const dataPath = join(config.dataDir, 'monsters.json');
const layoutPath = join(config.mapsDir, 'layout.json');

for (const p of [dataPath, layoutPath]) {
    if (!existsSync(p)) {
        throw new Error(`${p} missing — run bun gen.ts then bun lib/maps/bake.ts`);
    }
}

type Monster = {
    id: number;
    name: string;
    debug: string | null;
    level: number;
    stats: number[];
    drops: string[];
};
type Spawn = { x: number; z: number; level: number; id: number };
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

const data = JSON.parse(readFileSync(dataPath, 'utf8')) as {
    generation: { bounds: { minX: number; maxX: number; minZ: number; maxZ: number } };
    spawns: Spawn[];
    monsters: Record<string, Monster>;
};
const layout = JSON.parse(readFileSync(layoutPath, 'utf8')) as AreaLayout[];

let spawns = data.spawns.map(s => ({ ...s }));
// Only spawns that sit inside a baked area's trimmed tiles are visible.
spawns = spawns.filter(s =>
    layout.some(a => s.x >= a.tileX0 && s.x < a.tileX1 && s.z >= a.tileZBot && s.z <= a.tileZTop)
);
if (spawns.length === 0) {
    throw new Error('no spawns overlap the baked area tiles');
}
const monsters = data.monsters;

// Stack order top→bottom. Keep surface on top, then dungeon, then extra — or
// simply preserve the layout's natural order (surface, dungeon, extra).
const stack = layout.map(a => ({ ...a }));
const stackHeight = stack.reduce((n, a) => n + a.hPx, 0);
const stackWidth = Math.max(...stack.map(a => a.wPx));
// Cumulative pixel-y offset for each area within the stack.
let acc = 0;
for (const a of stack) {
    a['yOff'] = acc;
    acc += a.hPx;
}
type StackArea = AreaLayout & { yOff: number };

const html = render({ spawns, monsters, stack, stackWidth, stackHeight });
writeFileSync(join(config.outDir, 'monstermap.html'), html);
console.log(
    `wrote ${join(config.outDir, 'monstermap.html')} (${spawns.length} spawns, ${stack.length} areas, ${stackWidth}x${stackHeight}px stack)`
);

function render(payload: {
    spawns: Spawn[];
    monsters: Record<string, Monster>;
    stack: StackArea[];
    stackWidth: number;
    stackHeight: number;
}): string {
    const json = JSON.stringify({
        spawns: payload.spawns,
        monsters: payload.monsters,
        stack: payload.stack,
        stackWidth: payload.stackWidth,
        stackHeight: payload.stackHeight
    });
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
  #side{width:300px;padding:12px 14px;box-sizing:border-box;border-left:1px solid #232a31;overflow:auto;}
  h1{font-size:15px;margin:0 0 10px;}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8b96a3;margin:14px 0 6px;}
  label{display:block;margin:4px 0;}
  input[type=text]{width:100%;box-sizing:border-box;margin-top:3px;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:4px 6px;border-radius:4px;}
  input[type=range]{width:100%;box-sizing:border-box;}
  .hint{color:#6b7683;font-size:11px;margin-top:5px;}
  .legend{display:grid;grid-template-columns:14px 1fr;gap:4px 9px;align-items:center;}
  .sw{width:14px;height:12px;border-radius:2px;border:1px solid rgba(255,255,255,.08);}
  .areas label{display:flex;align-items:center;gap:6px;margin:3px 0;}
  .areas .chip{display:inline-block;min-width:60px;padding:1px 6px;border-radius:3px;font-size:11px;color:#0d1117;text-align:center;}
  #tip{position:absolute;pointer-events:none;background:rgba(10,14,18,.94);border:1px solid #2f3b47;padding:9px 11px;border-radius:6px;max-width:360px;display:none;z-index:9;}
  #tip b{font-size:13px;}
  .r{display:flex;gap:8px;margin-top:4px;}
  .stat{min-width:56px;color:#b9c4ce;}
  .kv{color:#8b96a3;}
  .drops{margin-top:6px;color:#7ee2a8;max-height:110px;overflow:auto;}
  #stats{position:absolute;left:12px;bottom:10px;background:rgba(18,22,27,.82);padding:5px 10px;border-radius:5px;font-size:12px;color:#aab6c2;}
  .area-label{position:absolute;left:4px;font-size:11px;color:#0d1117;background:rgba(231,238,247,.9);padding:1px 6px;border-radius:3px;pointer-events:none;opacity:.85;}
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
    <h2>Legend (vislevel)</h2>
    <div class="legend" id="legend"></div>
    <h2>Filter</h2>
    <input type="text" id="filter" placeholder="name e.g. goblin, dragon">
    <div class="hint">selecting a name flashes every exact match</div>
    <label>Min level <span id="minval">0</span>
      <input type="range" id="minlevel" min="0" max="170" value="0">
    </label>
    <label><input type="checkbox" id="showdrops" checked> show drop-table monsters</label>
    <div style="margin-top:16px;color:#8b96a3">drag: pan &middot; scroll: zoom &middot; hover: details</div>
  </div>
</div>
<script id="mmdata" type="application/json">${json}</script>
<script>
(function () {
"use strict";
var data = JSON.parse(document.getElementById("mmdata").textContent);
var spawns = data.spawns;
var monsters = data.monsters;
var stack = data.stack;         // [{name, png, wPx, hPx, yOff, tileX0, tileZTop, tileX1, tileZBot}]
var stackW = data.stackWidth;
var stackH = data.stackHeight;

var canvas = document.getElementById("c");
var ctx = canvas.getContext("2d");
var tip = document.getElementById("tip");
var statsEl = document.getElementById("stats");
var wrap = document.getElementById("wrap");
var dpr = window.devicePixelRatio || 1;
var W = 0, H = 0;

var imgs = {};
var loaded = 0;
var shownAreas = {};            // area index -> bool (checked boxes)

var gridMinX, gridMaxX, gridMinZ, gridMaxZ;
var ppt = 1;
var ox = 0, oy = 0;
var dragging = false, lastX = 0, lastY = 0;
var animId = 0;
var exactName = "";
var ALL_NAMES = [];

function colorFor(level) {
  if (level >= 126) return "#6d060e";
  if (level >= 77) return "#a31628";
  if (level >= 41) return "#d63e2b";
  if (level >= 17) return "#e0a33a";
  if (level >= 5) return "#7ea34a";
  if (level >= 2) return "#3b9867";
  return "#54748c";
}
function areaChipColor(ai) { return ["#7ea34a", "#a31628", "#e0a33a"][ai % 3] || "#54748c"; }
function legend() {
  var rows = [[2,"Civilian"],[5,"Low"],[17,"Mid"],[41,"High"],[77,"Elite"],[126,"Boss"],[0,"NPC"]];
  var h = "";
  for (var i = 0; i < rows.length; i++) {
    h += '<div class="sw" style="background:' + colorFor(rows[i][0]) + '"></div><div>' + rows[i][1] + '</div>';
  }
  document.getElementById("legend").innerHTML = h;
}

function stackArea(i) { return stack[i]; }

function areaScreenY(area) {
  // world row 0 of area's own image == screen top of its stack band
  return oy + area.yOff * ppt;
}
function areaScreenX(area, x) { return ox + (x - area.tileX0) * ppt; }

// A spawn lives in exactly one area; find it.
function spawnAreaIndex(s) {
  for (var i = 0; i < stack.length; i++) {
    var a = stack[i];
    if (s.x >= a.tileX0 && s.x < a.tileX1 && s.z >= a.tileZBot && s.z <= a.tileZTop) return i;
  }
  return -1;
}
// world coords of the stack (used for fit / zoom pivot)
function minWorldX() { var m = Infinity; for (var i=0;i<stack.length;i++) m = Math.min(m, stack[i].tileX0); return m; }
function maxWorldX() { var m = -Infinity; for (var i=0;i<stack.length;i++) m = Math.max(m, stack[i].tileX1); return m; }
function minWorldYband() {
  // top of the stack band in "world-ish" pixel terms = 0
  return 0;
}
function maxWorldYband() {
  // bottom of the stack band = stackH pixels at 1 ppt
  return stackH;
}

function fit() {
  var w = stackW, h = stackH;
  ppt = Math.min((W - 24) / w, (H - 24) / h);
  if (!ppt || ppt < 0.02) ppt = 0.5;
  // origin of the whole stack in screen px; centers it
  ox = (W - w * ppt) / 2;
  oy = (H - h * ppt) / 2;
  gridMinX = minWorldX(); gridMaxX = maxWorldX();
  gridMinZ = minWorldYband(); gridMaxZ = maxWorldYband();
}

function resize() {
  var r = wrap.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  requestDraw();
}
window.addEventListener("resize", resize);

// ---- drawing
function activeFilter() {
  var f = document.getElementById("filter").value.trim().toLowerCase();
  var m = Number(document.getElementById("minlevel").value);
  var showDrops = document.getElementById("showdrops").checked;
  return function (name, level) {
    if (!showDrops) return false;
    if (m && level < m) return false;
    if (f && name.toLowerCase().indexOf(f) === -1) return false;
    return true;
  };
}

function draw() {
  if (!W) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0a0e12";
  ctx.fillRect(0, 0, W, H);

  // terrain stack
  for (var i = 0; i < stack.length; i++) {
    if (!shownAreas[i]) continue;
    var a = stack[i];
    var img = imgs[a.png];
    if (!img) continue;
    var dx = ox, dy = oy + a.yOff * ppt;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, a.wPx * ppt, a.hPx * ppt);
    // area label chip at top-left of each band
    ctx.fillStyle = areaChipColor(a.ai);
    ctx.font = "11px ui-monospace,monospace";
    ctx.textAlign = "left";
    var lbl = a.name + "  " + a.wPx + "x" + a.hPx;
    var tw = ctx.measureText(lbl).width;
    ctx.fillRect(dx + 2, dy + 2, tw + 8, 16);
    ctx.fillStyle = "#0d1117";
    ctx.fillText(lbl, dx + 6, dy + 14);
  }

  var pass = activeFilter();
  var dot = Math.max(2.2, Math.min(18, ppt * 0.9));
  var shown = 0;

  // exact flash halos first
  if (exactName) {
    for (var hi = 0; hi < spawns.length; hi++) {
      var hs = spawns[hi];
      var hm = monsters[hs.id];
      var hai = spawnAreaIndex(hs);
      if (hai < 0 || !shownAreas[hai]) continue;
      if (!hm || !pass(hm.name, hm.level) || hm.name !== exactName) continue;
      var ha = stack[hai];
      var hx = areaScreenX(ha, hs.x), hy = areaScreenY(ha) + (ha.tileZTop - hs.z) * ppt;
      if (hx < -50 || hy < -50 || hx > W + 50 || hy > H + 50) continue;
      var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,213,79," + (0.16 + 0.34 * pulse) + ")";
      ctx.arc(hx, hy, 15 + dot * 2.1 + (1 - pulse) * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (var i = 0; i < spawns.length; i++) {
    var s = spawns[i];
    var m = monsters[s.id];
    var ai = spawnAreaIndex(s);
    if (ai < 0 || !shownAreas[ai]) continue;
    if (!m || !pass(m.name, m.level)) continue;
    var a = stack[ai];
    var px = areaScreenX(a, s.x), py = areaScreenY(a) + (a.tileZTop - s.z) * ppt;
    if (px < -40 || py < -40 || px > W + 40 || py > H + 40) continue;
    var is = exactName && m.name === exactName;
    ctx.globalAlpha = is ? 1 : exactName ? 0.28 : 1;
    ctx.fillStyle = colorFor(m.level);
    var d = is ? dot + 4 : dot;
    ctx.beginPath();
    ctx.arc(px, py, d, 0, Math.PI * 2);
    ctx.fill();
    shown++;
  }
  ctx.globalAlpha = 1;

  var lbl2 = exactName ? " · " + exactName : "";
  statsEl.textContent = shown + " / " + spawns.length + " drawn" + lbl2;
}
var drawPending = false;
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(function () { drawPending = false; draw(); });
}

// ---- tooltip
function nearest(sx, sy) {
  var pass = activeFilter();
  var best = null, bestD = 26 * 26;
  for (var i = 0; i < spawns.length; i++) {
    var s = spawns[i];
    var ai = spawnAreaIndex(s);
    if (ai < 0 || !shownAreas[ai]) continue;
    var m = monsters[s.id];
    if (!m || !pass(m.name, m.level)) continue;
    var a = stack[ai];
    var dx = areaScreenX(a, s.x) - sx, dy = (areaScreenY(a) + (a.tileZTop - s.z) * ppt) - sy;
    var d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
function esc(s) {
  return s.replace(/[&<>"']/g, function (c) {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    if (c === '"') return "&quot;";
    return "&#39;";
  });
}
function showTip(s) {
  if (!s) { tip.style.display = "none"; return; }
  var m = monsters[s.id];
  var ai = spawnAreaIndex(s);
  if (!m || ai < 0) { tip.style.display = "none"; return; }
  var st = m.stats || [0, 0, 0, 0, 0, 0];
  var html = "<b>" + esc(m.name) + "</b> <span class='kv'>#" + m.id + " &middot; lvl " + m.level + "</span>";
  html += '<div class="r"><div class="stat">HP ' + st[3] + '</div><div class="stat">ATK ' + st[0] + '</div><div class="stat">DEF ' + st[1] + '</div><div class="stat">STR ' + st[2] + '</div></div>';
  html += '<div class="r kv">' + esc(stack[ai].name) + " &middot; tile " + s.x + "," + s.z + " (floor " + s.level + ')</div>';
  if (m.drops && m.drops.length) {
    html += '<div class="r drops">drops: ' + esc(m.drops.join(", ")) + "</div>";
  }
  tip.innerHTML = html;
}

canvas.addEventListener("mousemove", function (e) {
  var r = wrap.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  if (dragging) {
    ox += mx - lastX; oy += my - lastY;
    lastX = mx; lastY = my;
    requestDraw();
    return;
  }
  var s = nearest(mx, my);
  tip.style.left = (mx + 14) + "px";
  tip.style.top = (my + 14) + "px";
  if (s) { showTip(s); tip.style.display = "block"; }
  else { tip.style.display = "none"; }
});
canvas.addEventListener("mouseleave", function () { tip.style.display = "none"; });
canvas.addEventListener("mousedown", function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mouseup", function () { dragging = false; });

canvas.addEventListener("wheel", function (e) {
  e.preventDefault();
  var r = wrap.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  // zoom pivot in stack-pixel space (1x ppt == stack px)
  var spx = (mx - ox) / ppt, spy = (my - oy) / ppt;
  var factor = Math.exp(-e.deltaY * 0.002);
  var next = Math.min(64, Math.max(0.2, ppt * factor));
  ox = mx - spx * next;
  oy = my - spy * next;
  ppt = next;
  requestDraw();
}, { passive: false });

// ---- exact-name flash
function buildAllNames() {
  var seen = {};
  for (var i = 0; i < spawns.length; i++) {
    var mo = monsters[spawns[i].id];
    if (mo) seen[mo.name] = 1;
  }
  ALL_NAMES = Object.keys(seen).sort();
}
function setExact(v) {
  exactName = v;
  if (exactName) {
    cancelAnimationFrame(animId);
    tick();
  } else {
    requestDraw();
  }
}
function tick() {
  if (!exactName) return;
  draw();
  animId = requestAnimationFrame(tick);
}
function rebuildExact() {
  var q = document.getElementById("filter").value.trim().toLowerCase();
  if (!q) { setExact(""); return; }
  var matches = [];
  for (var j = 0; j < ALL_NAMES.length; j++) {
    var n = ALL_NAMES[j];
    if (n.toLowerCase().indexOf(q) === -1) continue;
    matches.push(n);
  }
  if (matches.length === 1) setExact(matches[0]);
  else setExact("");
}

// ---- area checkboxes
function buildAreas() {
  var box = document.getElementById("areas");
  var h = "";
  for (var i = 0; i < stack.length; i++) {
    var a = stack[i];
    h += '<label><input type="checkbox" data-area="' + i + '" checked> <span class="chip" style="background:' + areaChipColor(a.ai) + '">' + esc(a.name) + '</span> ' + a.wPx + "x" + a.hPx + '</label>';
  }
  box.innerHTML = h;
  box.addEventListener("change", function (e) {
    var t = e.target;
    var i = Number(t.getAttribute("data-area"));
    shownAreas[i] = t.checked;
    requestDraw();
  });
}

// ---- load images + boot
function loadImages() {
  var all = {};
  for (var i = 0; i < stack.length; i++) {
    shownAreas[i] = true;
    var url = "maps/" + stack[i].png;
    (function (a) {
      var img = new Image();
      img.onload = function () { loaded++; imgs[a.png] = img; if (loaded === stack.length) { requestDraw(); } };
      img.src = url;
    })(stack[i]);
  }
}

(function boot() {
  buildAreas();
  legend();
  buildAllNames();
  resize();
  fit();
  document.getElementById("filter").addEventListener("input", function () {
    rebuildExact();
    requestDraw();
  });
  document.getElementById("minlevel").addEventListener("input", function () {
    document.getElementById("minval").textContent = document.getElementById("minlevel").value;
    requestDraw();
  });
  document.getElementById("showdrops").addEventListener("change", requestDraw);
  loadImages();
  statsEl.textContent = "loading maps…";
})();
})();
</script>
</body>
</html>`;
}