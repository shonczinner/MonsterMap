/**
 * mapClustering — flash-matching + cluster de-duplication helpers for MonsterMap.
 *
 * Written as dependency-free plain JS so map.ts can inline this file's source
 * straight into the page <script> (the project has no browser bundler). All
 * functions are pure except they take the page state (points, filters, query)
 * as arguments.
 */

// Does point `p` flash for the active query `exactName`? Returns a source key
// ('drop' | 'spawn' | 'shop') or null. Matching is exact (the selection always
// comes from the dropdown, so it's a canonical name) — fishing-spot `sub` is a
// comma-separated fish list, so it's matched per token.
function flashKind(p, exactName) {
  if (!exactName) return null;
  if (p.name === exactName) return p.cat === 'item' ? 'spawn' : (p.hasShop ? 'shop' : 'drop');
  if (p.shop) {
    for (var si = 0; si < p.shop.shops.length; si++) {
      var sh = p.shop.shops[si];
      if (sh.title === exactName) return 'shop';
      for (var ii = 0; ii < sh.items.length; ii++) if (sh.items[ii].name === exactName) return 'shop';
    }
  }
  if (p.drops && p.drops.indexOf(exactName) >= 0) return 'drop';
  if (p.sub) {
    var q = exactName.toLowerCase(), toks = p.sub.split(',');
    for (var ti = 0; ti < toks.length; ti++) {
      if (toks[ti].trim().toLowerCase().startsWith(q)) return 'drop';
    }
  }
  return null;
}

// Collect visible points that match the query (layer + area filters applied).
function collectMatches(pts, exactName, shownCats, shownAreas, spawnAreaIndex) {
  var out = [];
  for (var k = 0; k < pts.length; k++) {
    var p = pts[k];
    if (!shownCats[p.cat]) continue;
    var ai = spawnAreaIndex(p.x, p.z);
    if (ai < 0 || !shownAreas[ai]) continue;
    if (flashKind(p, exactName)) out.push(p);
  }
  return out;
}

// Greedy de-dupe: keep a point unless another already-kept point of the SAME
// category is within `minDist` tiles. Returns the navigation (snapping) list.
function dedupeByCluster(raw, minDist) {
  var sel = [], r2 = minDist * minDist;
  for (var a = 0; a < raw.length; a++) {
    var pp = raw[a], keep = true;
    for (var b = 0; b < sel.length; b++) {
      var dx = pp.x - sel[b].x, dz = pp.z - sel[b].z;
      if (dx * dx + dz * dz <= r2 && sel[b].cat === pp.cat) { keep = false; break; }
    }
    if (keep) sel.push(pp);
  }
  return sel;
}

// Group points into same-category clumps within `minDist` tiles.
// Returns [{ cat, pts:[...] }] keyed by world coords; callers add screen px/py
// (pts entries carry `px`/`py` as pushed by the draw loop).
function buildClusters(flashPts, minDist) {
  var r2 = minDist * minDist, clusters = [];
  for (var i = 0; i < flashPts.length; i++) {
    var fp = flashPts[i], placed = false;
    for (var j = 0; j < clusters.length; j++) {
      var cl = clusters[j];
      var dx = fp.p.x - cl.x, dz = fp.p.z - cl.z;
      if (dx * dx + dz * dz <= r2 && cl.cat === fp.cat) { cl.pts.push(fp); placed = true; break; }
    }
    if (!placed) clusters.push({ x: fp.p.x, z: fp.p.z, cat: fp.cat, pts: [fp] });
  }
  return clusters;
}
