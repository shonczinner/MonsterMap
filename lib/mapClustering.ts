// @ts-nocheck
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
      if (dx * dx + dz * dz <= r2 && sel[b].cat === pp.cat && sel[b].name === pp.name) { keep = false; break; }
    }
    if (keep) sel.push(pp);
  }
  return sel;
}

// Group points into same-name (and same-category) clumps within `minDist`
// tiles. Grouping by name means a drop search that flashes several different
// monsters does NOT merge them into a single disc — each monster keeps its own
// cluster. Returns [{ name, cat, pts:[...] }] keyed by world coords; callers
// add screen px/py (pts entries carry `px`/`py` as pushed by the draw loop).
function buildClusters(flashPts, minDist) {
  var r2 = minDist * minDist, clusters = [];
  for (var i = 0; i < flashPts.length; i++) {
    var fp = flashPts[i], placed = false;
    for (var j = 0; j < clusters.length; j++) {
      var cl = clusters[j];
      var dx = fp.p.x - cl.x, dz = fp.p.z - cl.z;
      if (dx * dx + dz * dz <= r2 && cl.cat === fp.cat && cl.name === fp.p.name) { cl.pts.push(fp); placed = true; break; }
    }
    if (!placed) clusters.push({ x: fp.p.x, z: fp.p.z, cat: fp.cat, name: fp.p.name, pts: [fp] });
  }
  return clusters;
}

// Same grouping rule as buildClusters (same category + name within minDist
// tiles), but for the whole map (~30k points) rather than a search result.
// Points are bucketed by `cat|name` and then by spatial cell, so each point
// only checks the clusters in the 3x3 cells around it instead of every cluster.
function buildAllClusters(points, minDist) {
  var r2 = minDist * minDist;
  var cell = Math.max(1, minDist);
  var buckets = {}, keys = [];
  for (var i = 0; i < points.length; i++) {
    var p = points[i], key = p.cat + '\u0000' + p.name;
    if (!buckets[key]) { buckets[key] = { pts: [], cells: {}, out: [] }; keys.push(key); }
    buckets[key].pts.push(p);
  }
  var out = [];
  for (var ki = 0; ki < keys.length; ki++) {
    var b = buckets[keys[ki]], list = b.pts, cells = b.cells;
    for (var pi = 0; pi < list.length; pi++) {
      var pp = list[pi];
      var cx = Math.floor(pp.x / cell), cz = Math.floor(pp.z / cell), placed = false;
      for (var dz = -1; dz <= 1 && !placed; dz++) {
        for (var dx = -1; dx <= 1 && !placed; dx++) {
          var arr = cells[(cx + dx) + ',' + (cz + dz)];
          if (!arr) continue;
          for (var ci = 0; ci < arr.length; ci++) {
            var cl = arr[ci];
            var ddx = pp.x - cl.x, ddz = pp.z - cl.z;
            if (ddx * ddx + ddz * ddz <= r2) { cl.pts.push(pp); placed = true; break; }
          }
        }
      }
      if (!placed) {
        var ncl = { x: pp.x, z: pp.z, cat: pp.cat, name: pp.name, pts: [pp] };
        b.out.push(ncl); out.push(ncl);
        var ck = cx + ',' + cz;
        (cells[ck] || (cells[ck] = [])).push(ncl);
      }
    }
  }
  return out;
}

// Drop clusters smaller than `minSize` (both cluster views honour this).
function visibleClusters(clusters, minSize) {
  if (!minSize || minSize <= 1) return clusters;
  var out = [];
  for (var i = 0; i < clusters.length; i++) {
    if (clusters[i].pts.length >= minSize) out.push(clusters[i]);
  }
  return out;
}
