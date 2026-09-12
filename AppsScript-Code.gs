/****************************************************************
 * 攤位收銀台 — Google Apps Script 後端（線上模式用）
 *
 * 安裝方式見 README-線上模式.txt
 * 這支程式綁在一份 Google 試算表上，部署成 Web App 後
 * 就是所有「線上模式攤位」共用的後端。
 *
 * 分頁（第一次執行會自動建立）：
 *   Stalls    攤位索引：code / stallId / name / vendDate / createdAt / catalogRev / updatedAt
 *   Catalog   商品目錄（JSON 分段存放）：code / seq / chunk
 *   Stock     庫存（一個規格一列）：code / pvId / label / stock / sold
 *   Orders    訂單紀錄：code / orderId / time / free / total / listTotal / lines
 *   Failures  結帳失敗紀錄：code / time / reason / detail
 ****************************************************************/

var CHUNK = 40000;                                  // 單一儲存格上限 5 萬字，保守切 4 萬
var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 排除易混淆的 0 O 1 I L
var LOCK_MS = 25000;

/* ---------------- 入口 ---------------- */

function doGet(e) {
  return out({ ok: true, msg: '攤位收銀台後端運作中', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'BAD_JSON', message: '請求格式錯誤' });
  }
  try {
    switch (req.action) {
      case 'ping':         return out({ ok: true, time: new Date().toISOString() });
      case 'create':       return out(createStall(req));
      case 'join':         return out(joinStall(req));
      case 'pull':         return out(pullStall(req));
      case 'pushCatalog':  return out(pushCatalog(req));
      case 'checkout':     return out(checkout(req));
      case 'delOrder':     return out(delOrder(req));
      case 'clearOrders':  return out(clearOrders(req));
      default:             return out({ ok: false, error: 'UNKNOWN_ACTION', message: '未知的動作：' + req.action });
    }
  } catch (err) {
    return out({ ok: false, error: 'SERVER_ERROR', message: String((err && err.message) || err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 分頁工具 ---------------- */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheetOf(name, headers) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.appendRow(headers);
    s.setFrozenRows(1);
  }
  return s;
}
function shStalls()   { return sheetOf('Stalls',   ['code', 'stallId', 'name', 'vendDate', 'createdAt', 'catalogRev', 'updatedAt']); }
function shCatalog()  { return sheetOf('Catalog',  ['code', 'seq', 'chunk']); }
function shStock()    { return sheetOf('Stock',    ['code', 'pvId', 'label', 'stock', 'sold']); }
function shOrders()   { return sheetOf('Orders',   ['code', 'orderId', 'time', 'free', 'total', 'listTotal', 'lines']); }
function shFailures() { return sheetOf('Failures', ['code', 'time', 'reason', 'detail']); }

function up(v) { return String(v || '').trim().toUpperCase(); }

function rowsFor(sheet, code) {
  var vals = sheet.getDataRange().getValues();
  var res = [];
  for (var i = 1; i < vals.length; i++) {
    if (up(vals[i][0]) === code) res.push({ row: i + 1, v: vals[i] });
  }
  return res;
}

function deleteRowsFor(sheet, code) {
  var vals = sheet.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (up(vals[i][0]) === code) sheet.deleteRow(i + 1);
  }
}

function appendRows(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/* ---------------- 攤位索引 ---------------- */

function findStallRow(code) {
  var vals = shStalls().getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (up(vals[i][0]) === code) return { row: i + 1, v: vals[i] };
  }
  return null;
}

function newCode() {
  var vals = shStalls().getDataRange().getValues();
  var used = {};
  for (var i = 1; i < vals.length; i++) used[up(vals[i][0])] = true;
  for (var t = 0; t < 500; t++) {
    var c = '';
    for (var j = 0; j < 4; j++) c += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    if (!used[c]) return c;
  }
  throw new Error('無法產生未使用的攤位代碼');
}

function touchStall(code, opts) {
  var hit = findStallRow(code);
  if (!hit) return;
  var sh = shStalls();
  if (opts && opts.name)      sh.getRange(hit.row, 3).setValue(opts.name);
  if (opts && opts.vendDate)  sh.getRange(hit.row, 4).setValue(opts.vendDate);
  if (opts && opts.catalogRev) sh.getRange(hit.row, 6).setValue(opts.catalogRev);
  sh.getRange(hit.row, 7).setValue(new Date());
}

/* ---------------- 商品目錄（分段 JSON） ---------------- */

function writeCatalog(code, catalog) {
  var sh = shCatalog();
  deleteRowsFor(sh, code);
  var s = JSON.stringify(catalog || {});
  var rows = [];
  for (var i = 0, seq = 0; i < s.length; i += CHUNK, seq++) {
    rows.push([code, seq, s.substring(i, i + CHUNK)]);
  }
  if (!rows.length) rows.push([code, 0, '{}']);
  appendRows(sh, rows);
}

function readCatalog(code) {
  var list = rowsFor(shCatalog(), code);
  if (!list.length) return null;
  list.sort(function (a, b) { return Number(a.v[1]) - Number(b.v[1]); });
  var s = list.map(function (x) { return String(x.v[2]); }).join('');
  try { return JSON.parse(s); } catch (err) { return null; }
}

/* 目錄 -> 可售單位清單（無規格＝商品本身，有規格＝每個變體） */
function unitsOf(catalog) {
  var res = [];
  ((catalog && catalog.products) || []).forEach(function (p) {
    if (p.specs && p.specs.length && p.variants && p.variants.length) {
      p.variants.forEach(function (v) {
        res.push({
          pvId: v.id, label: p.name + '（' + v.key + '）',
          stock: Number(v.stock) || 0, sold: Number(v.sold) || 0,
          reserved: Number(v.reserved) || 0
        });
      });
    } else {
      res.push({
        pvId: p.id, label: p.name,
        stock: Number(p.stock) || 0, sold: Number(p.sold) || 0,
        reserved: Number(p.reserved) || 0
      });
    }
  });
  return res;
}

/* ---------------- 庫存 ---------------- */

function readStock(code) {
  var map = {};
  rowsFor(shStock(), code).forEach(function (x) {
    map[String(x.v[1])] = { stock: Number(x.v[3]) || 0, sold: Number(x.v[4]) || 0 };
  });
  return map;
}

/* 依目錄重建庫存列：既有 pvId 保留伺服器上的 stock/sold，新的用目錄值，消失的移除。
   stockSet：使用者這次「明確修改過」的庫存，直接覆蓋。 */
function syncStockRows(code, catalog, stockSet) {
  var units = unitsOf(catalog);
  var cur = readStock(code);
  var rows = units.map(function (u) {
    var has = cur[u.pvId];
    var stock = has ? has.stock : u.stock;
    var sold  = has ? has.sold  : u.sold;
    if (stockSet && stockSet.hasOwnProperty(u.pvId)) stock = Number(stockSet[u.pvId]) || 0;
    return [code, u.pvId, u.label, stock, sold];
  });
  var sh = shStock();
  deleteRowsFor(sh, code);
  appendRows(sh, rows);
}

function applyStockDelta(code, deltas) {
  var sh = shStock();
  var vals = sh.getDataRange().getValues();
  var changed = false;
  for (var i = 1; i < vals.length; i++) {
    if (up(vals[i][0]) !== code) continue;
    var pv = String(vals[i][1]);
    if (deltas[pv]) {
      vals[i][3] = (Number(vals[i][3]) || 0) - deltas[pv];
      vals[i][4] = (Number(vals[i][4]) || 0) + deltas[pv];
      changed = true;
    }
  }
  if (changed) sh.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
}

function reservedMap(catalog) {
  var m = {};
  unitsOf(catalog).forEach(function (u) { m[u.pvId] = u.reserved; });
  return m;
}
function labelMap(catalog) {
  var m = {};
  unitsOf(catalog).forEach(function (u) { m[u.pvId] = u.label; });
  return m;
}

/* ---------------- 訂單 ---------------- */

function readOrders(code) {
  return rowsFor(shOrders(), code).map(function (x) {
    var lines = [];
    try { lines = JSON.parse(String(x.v[6] || '[]')); } catch (err) { lines = []; }
    var t = x.v[2];
    return {
      id: String(x.v[1]),
      time: (t instanceof Date) ? t.getTime() : (Number(t) || Date.parse(String(t)) || Date.now()),
      free: String(x.v[3]).toUpperCase() === 'TRUE',
      total: Number(x.v[4]) || 0,
      listTotal: Number(x.v[5]) || 0,
      lines: lines
    };
  }).sort(function (a, b) { return a.time - b.time; });
}

/* 把一筆訂單的庫存影響反轉回去 */
function restoreDeltasOf(lines) {
  var d = {};
  (lines || []).forEach(function (l) {
    (l.restore || []).forEach(function (r) {
      d[r.pvId] = (d[r.pvId] || 0) + (Number(r.qty) || 0);
    });
  });
  return d;
}
function applyStockRestore(code, deltas) {
  var sh = shStock();
  var vals = sh.getDataRange().getValues();
  var changed = false;
  for (var i = 1; i < vals.length; i++) {
    if (up(vals[i][0]) !== code) continue;
    var pv = String(vals[i][1]);
    if (deltas[pv]) {
      vals[i][3] = (Number(vals[i][3]) || 0) + deltas[pv];
      vals[i][4] = Math.max(0, (Number(vals[i][4]) || 0) - deltas[pv]);
      changed = true;
    }
  }
  if (changed) sh.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
}

/* ---------------- 快照 ---------------- */

function snapshot(code) {
  var hit = findStallRow(code);
  return {
    code: code,
    stock: readStock(code),
    orders: readOrders(code),
    catalogRev: hit ? String(hit.v[5] || '') : '',
    serverTime: new Date().toISOString()
  };
}

/* ---------------- 動作 ---------------- */

function createStall(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return { ok: false, error: 'BUSY', message: '伺服器忙碌中，請再試一次' };
  try {
    var code = newCode();
    var cat = req.catalog || {};
    var rev = String(Date.now());
    shStalls().appendRow([
      code, String(req.stallId || ''), String(cat.name || ''), String(cat.vendDate || ''),
      new Date(), rev, new Date()
    ]);
    writeCatalog(code, cat);
    syncStockRows(code, cat, null);
    return { ok: true, code: code, state: snapshot(code) };
  } finally { lock.releaseLock(); }
}

function joinStall(req) {
  var code = up(req.code);
  var cat = readCatalog(code);
  if (!cat) return { ok: false, error: 'NO_STALL', message: '找不到代碼 ' + code + ' 的攤位' };
  return { ok: true, code: code, catalog: cat, state: snapshot(code) };
}

function pullStall(req) {
  var code = up(req.code);
  var hit = findStallRow(code);
  if (!hit) return { ok: false, error: 'NO_STALL', message: '找不到代碼 ' + code + ' 的攤位' };
  var rev = String(hit.v[5] || '');
  var res = { ok: true, code: code, state: snapshot(code) };
  if (String(req.have || '') !== rev) res.catalog = readCatalog(code);   // 目錄有變才回傳（省流量）
  return res;
}

function pushCatalog(req) {
  var code = up(req.code);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return { ok: false, error: 'BUSY', message: '伺服器忙碌中，請再試一次' };
  try {
    if (!findStallRow(code)) return { ok: false, error: 'NO_STALL', message: '找不到代碼 ' + code + ' 的攤位' };
    var cat = req.catalog || {};
    var rev = String(Date.now());
    writeCatalog(code, cat);
    syncStockRows(code, cat, req.stockSet || null);
    touchStall(code, { name: cat.name, vendDate: cat.vendDate, catalogRev: rev });
    return { ok: true, code: code, catalogRev: rev, state: snapshot(code) };
  } finally { lock.releaseLock(); }
}

/* 結帳：整段鎖定，讀最新庫存 -> 驗證 -> 扣庫存 + 寫訂單 */
function checkout(req) {
  var code = up(req.code);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return { ok: false, error: 'BUSY', message: '伺服器忙碌中，請稍後再送一次' };
  try {
    var cat = readCatalog(code);
    if (!cat) return { ok: false, error: 'NO_STALL', message: '找不到代碼 ' + code + ' 的攤位' };

    var stock = readStock(code);
    var resv  = reservedMap(cat);
    var label = labelMap(cat);

    // 把需求彙總（同一 pvId 合併），任一筆允許動用預留就整體允許
    var need = {};
    (req.need || []).forEach(function (n) {
      var k = String(n.pvId);
      if (!need[k]) need[k] = { qty: 0, allowReserved: false };
      need[k].qty += Number(n.qty) || 0;
      if (n.allowReserved) need[k].allowReserved = true;
    });

    var short = [];
    Object.keys(need).forEach(function (pv) {
      var cur = stock[pv];
      var nm = label[pv] || pv;
      if (!cur) { short.push(nm + '：商品已不存在或已被刪除'); return; }
      var avail = need[pv].allowReserved ? cur.stock : Math.max(0, cur.stock - (resv[pv] || 0));
      if (avail < need[pv].qty) short.push(nm + '：可售 ' + avail + '、需要 ' + need[pv].qty);
    });

    if (short.length) {
      var reason = short.join('；');
      shFailures().appendRow([code, new Date(), reason, JSON.stringify(req.order || {}).substring(0, 45000)]);
      return { ok: false, error: 'OUT_OF_STOCK', message: reason, state: snapshot(code) };
    }

    var deltas = {};
    Object.keys(need).forEach(function (pv) { deltas[pv] = need[pv].qty; });
    applyStockDelta(code, deltas);

    var o = req.order || {};
    shOrders().appendRow([
      code, String(o.id || ('o' + Date.now())),
      o.time ? new Date(Number(o.time)) : new Date(),
      o.free ? 'TRUE' : 'FALSE',
      Number(o.total) || 0, Number(o.listTotal) || 0,
      JSON.stringify(o.lines || []).substring(0, 45000)
    ]);
    touchStall(code, {});
    return { ok: true, state: snapshot(code) };
  } finally { lock.releaseLock(); }
}

function delOrder(req) {
  var code = up(req.code);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return { ok: false, error: 'BUSY', message: '伺服器忙碌中，請再試一次' };
  try {
    var sh = shOrders();
    var list = rowsFor(sh, code).filter(function (x) { return String(x.v[1]) === String(req.orderId); });
    if (!list.length) return { ok: false, error: 'NO_ORDER', message: '找不到這筆訂單（可能已被其他裝置刪除）', state: snapshot(code) };
    var lines = [];
    try { lines = JSON.parse(String(list[0].v[6] || '[]')); } catch (err) { lines = []; }
    applyStockRestore(code, restoreDeltasOf(lines));
    sh.deleteRow(list[0].row);
    touchStall(code, {});
    return { ok: true, state: snapshot(code) };
  } finally { lock.releaseLock(); }
}

function clearOrders(req) {
  var code = up(req.code);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return { ok: false, error: 'BUSY', message: '伺服器忙碌中，請再試一次' };
  try {
    var all = readOrders(code);
    var deltas = {};
    all.forEach(function (o) {
      var d = restoreDeltasOf(o.lines);
      Object.keys(d).forEach(function (pv) { deltas[pv] = (deltas[pv] || 0) + d[pv]; });
    });
    applyStockRestore(code, deltas);
    deleteRowsFor(shOrders(), code);
    touchStall(code, {});
    return { ok: true, state: snapshot(code) };
  } finally { lock.releaseLock(); }
}
