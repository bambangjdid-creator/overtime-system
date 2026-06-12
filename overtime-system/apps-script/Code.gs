/*******************************************************************
 * OVERTIME SYSTEM (OT-SYS) — BACKEND (Google Apps Script)
 * Database : Google Spreadsheet
 * Storage  : Google Drive
 * Sheets   : USER_ROLE, MENU_SETTINGS, APPROVAL_ROLE, DIVISI_ROLE,
 *            DATA_KARYAWAN, OT_HEADER, OT_DETAIL, REPORT, AUDIT_LOG
 *******************************************************************/

const SS_ID = '1MEx2dqHuV21QPVplJGgcX1obzvFuPgUqjbw1CkXpAMk'; // default (fallback)
const SHEETS = {
  USER: 'USER_ROLE',
  MENU: 'MENU_SETTINGS',
  APPROVAL: 'APPROVAL_ROLE',
  DIVISI: 'DIVISI_ROLE',
  KARYAWAN: 'DATA_KARYAWAN',
  HEADER: 'OT_HEADER',
  DETAIL: 'OT_DETAIL',
  REPORT: 'REPORT',
  AUDIT: 'AUDIT_LOG'
};
const SESSION_TTL = 8 * 60 * 60;      // 8 jam
const CACHE_TTL   = 300;              // 5 menit utk master data
const DRIVE_FOLDER = 'OT_ATTACHMENTS';

/* ---- USER DEMO BAWAAN (fallback ADMIN) -------------------------
   Hanya aktif SELAMA sheet belum tersinkronisasi (sheet wajib
   belum lengkap ATAU USER_ROLE belum berisi user valid).
   Begitu semua sheet sinkron + USER_ROLE terisi → otomatis
   NONAKTIF & TERSEMBUNYI. ---------------------------------------- */
const DEMO_ADMIN = {
  username: 'DEMO',
  password: 'DEMO123',
  fullName: 'DEMO ADMINISTRATOR',
  role: 'ADMIN',
  menus: ['Dashboard', 'Form OT', 'OT History', 'Approval', 'Audit Log', 'Report', 'Settings']
};

/* ============================ ENTRY ============================ */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Overtime System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** REST API endpoint utk frontend eksternal (GitHub Pages, dll).
 *  Body JSON: { fn:"apiXxx", args:[...] } → balasan JSON.
 *  Kirim dgn Content-Type: text/plain agar bebas CORS preflight.
 *  Keamanan: hanya fungsi berawalan "api" yang boleh dipanggil,
 *  dan semua fungsi sensitif tetap memvalidasi session token. */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = String(req.fn || '');
    if (!/^api[A-Za-z0-9]+$/.test(fn)) throw new Error('Fungsi tidak diizinkan: ' + fn);
    const f = globalThis[fn];
    if (typeof f !== 'function') throw new Error('Fungsi tidak ditemukan: ' + fn);
    out = f.apply(null, req.args || []);
  } catch (err) {
    out = { ok: false, __error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================ UTIL ============================= */
/** Normalisasi nama sheet/kolom: buang non-alfanumerik, uppercase.
 *  "OT_HEADER " ≈ "OT_HEADER" ≈ "ot header" ≈ "OTHEADER" */
function _normName(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }

/** Daftar kanonis seluruh kolom yang dipakai aplikasi — header sheet
 *  yang berbeda kapital/spasi otomatis dipetakan ke nama kanonis ini. */
const CANON_COLS = ['Username','Password','FullName','Role','AksesMenu',
  'IdMenu','MenuName','IdParent','RoutePath','OrderIndex','IsActive',
  'IdMatrix','IdDivisi','ApprovalLevel','IdApproval',
  'Divisi','SubDivisi','IdSubdiv','IdManager',
  'Nik','IdKaryawan','NamaKaryawan','Jabatan','Status',
  'IdDok','TanggalLembur','NamaPeminta','JenisLembur','TotalKaryawan','TotalDurasi','TotalNominal','StatusDokumen',
  'TanggalPengajuan','LokasiLembur','JamMulai','JamSelesai','DurasiLembur','Nominal','AlasanLembur','CatatanManager',
  'Timestamp','User','Action','Details'];
const CANON_MAP = (function(){ const m = {}; CANON_COLS.forEach(c => m[_normName(c)] = c); return m; })();

/** Index kolom dgn pencocokan toleran (exact dulu, lalu normalized). */
function _colIdx(head, name) {
  let i = head.indexOf(name);
  if (i > -1) return i;
  const want = _normName(name);
  for (let j = 0; j < head.length; j++) if (_normName(head[j]) === want) return j;
  return -1;
}
/** Spreadsheet aktif: pakai ID hasil Sinkronisasi (Script Properties)
 *  bila ada; jika tidak, fallback ke SS_ID default di atas. */
function _activeSsId() {
  return PropertiesService.getScriptProperties().getProperty('SS_ID_OVERRIDE') || SS_ID;
}
function _ss() { return SpreadsheetApp.openById(_activeSsId()); }
/** Ekstrak Spreadsheet ID dari URL GSheet / ID mentah. */
function _extractSsId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return '';
}
function _sheet(name) {
  const ss = _ss();
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  // Pencocokan toleran: "OT_HEADER " / "ot_header" / "OT HEADER" tetap ketemu
  const want = _normName(name);
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) {
    if (_normName(all[i].getName()) === want) return all[i];
  }
  throw new Error('Sheet tidak ditemukan: ' + name);
}
function _rows(name) {
  // Baca seluruh sheet → array of object (header = baris 1).
  // Nama kolom dinormalisasi ke bentuk kanonis (CANON_MAP) sehingga
  // header beda kapital/spasi (mis. "iddok", "Tanggal Lembur ") tetap terbaca.
  const v = _sheet(name).getDataRange().getValues();
  if (v.length < 2) return [];
  const head = v[0].map(h => String(h).trim());
  return v.slice(1)
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => {
      const o = {};
      head.forEach((h, i) => {
        if (!h) return;
        const canon = CANON_MAP[_normName(h)] || h;
        if (!(canon in o)) o[canon] = r[i];
      });
      return o;
    });
}
function _cached(key, fn) {
  const c = CacheService.getScriptCache();
  const hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const data = fn();
  try { c.put(key, JSON.stringify(data), CACHE_TTL); } catch (e) {}
  return data;
}
function _bustCache(keys) { CacheService.getScriptCache().removeAll(keys); }
function _fmtDate(d) {
  if (d instanceof Date) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(d || '');
}
function _fmtTs(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
function _num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function _rp(n) { return 'Rp ' + Math.round(n).toLocaleString('en-US'); }

/* ==================== SYNC STATUS / DEMO MODE ================== */
/**
 * Cek apakah seluruh sheet wajib ada & USER_ROLE berisi user valid.
 * return {synced:boolean, missing:[], userCount:n}
 */
function _syncStatus() {
  return _cached('sync_status', () => {
    const required = [SHEETS.USER, SHEETS.MENU, SHEETS.APPROVAL, SHEETS.DIVISI,
      SHEETS.KARYAWAN, SHEETS.HEADER, SHEETS.DETAIL, SHEETS.AUDIT];
    const ss = _ss();
    const missing = required.filter(n => { try { _sheet(n); return false; } catch (e) { return true; } });
    let userCount = 0;
    if (!missing.includes(SHEETS.USER)) {
      userCount = _rows(SHEETS.USER).filter(u =>
        String(u.Username || '').trim() && String(u.Password || '').trim() && String(u.Role || '').trim()
      ).length;
    }
    return { synced: missing.length === 0 && userCount > 0, missing: missing, userCount: userCount };
  });
}
function _demoActive() { return !_syncStatus().synced; }

/* ====================== AUTH & SESSION ========================= */
function _newToken() { return Utilities.getUuid().replace(/-/g, ''); }
function _putSession(token, user) {
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(user), SESSION_TTL);
}
function _getSession(token) {
  if (!token) throw new Error('SESSION_EXPIRED');
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  const user = JSON.parse(raw);
  // Sesi demo langsung gugur begitu sheet tersinkronisasi
  if (user.isDemo && !_demoActive()) {
    CacheService.getScriptCache().remove('sess_' + token);
    throw new Error('SESSION_EXPIRED: user demo dinonaktifkan, silakan login dengan akun resmi');
  }
  _putSession(token, user); // sliding expiry
  return user;
}
function _requireMenu(user, menuName) {
  const want = String(menuName).replace(/\s+/g, ' ').trim().toUpperCase();
  const has = (user.menus || []).some(m => String(m).replace(/\s+/g, ' ').trim().toUpperCase() === want);
  if (!has) throw new Error('FORBIDDEN: tidak punya akses ' + menuName);
}

function apiLogin(username, password) {
  username = String(username || '').trim().toUpperCase();

  // --- USER DEMO (fallback): hanya selama sheet BELUM tersinkronisasi ---
  if (username === DEMO_ADMIN.username) {
    if (!_demoActive()) {
      _audit(username, 'LOGIN_FAILED', 'User demo sudah dinonaktifkan (sheet tersinkronisasi)');
      return { ok: false, error: 'Username atau password salah' };
    }
    if (String(password || '').trim() !== DEMO_ADMIN.password) {
      _audit(username, 'LOGIN_FAILED', 'Percobaan login demo gagal');
      return { ok: false, error: 'Username atau password salah' };
    }
    const demoUser = { username: DEMO_ADMIN.username, fullName: DEMO_ADMIN.fullName, role: DEMO_ADMIN.role, menus: DEMO_ADMIN.menus, isDemo: true };
    const dToken = _newToken();
    _putSession(dToken, demoUser);
    _audit(demoUser.username, 'LOGIN', 'Login DEMO ADMIN (sheet belum tersinkronisasi)');
    return { ok: true, token: dToken, user: demoUser, bootstrap: _bootstrap(demoUser), demoActive: true, syncStatus: _syncStatus() };
  }

  const users = _rows(SHEETS.USER);
  const u = users.find(x =>
    String(x.Username).trim().toUpperCase() === username &&
    String(x.Password).trim() === String(password || '').trim());
  if (!u) {
    _audit(username || '-', 'LOGIN_FAILED', 'Percobaan login gagal');
    return { ok: false, error: 'Username atau password salah' };
  }
  const menus = String(u.AksesMenu || '').split(',').map(s => s.trim()).filter(Boolean);
  const user = { username: String(u.Username).trim(), fullName: String(u.FullName).trim(), role: String(u.Role).trim().toUpperCase(), menus: menus };
  const token = _newToken();
  _putSession(token, user);
  _audit(user.username, 'LOGIN', 'Login berhasil (' + user.role + ')');
  return { ok: true, token: token, user: user, bootstrap: _bootstrap(user), demoActive: _demoActive() };
}

/** Dipanggil halaman login utk menampilkan/menyembunyikan hint user demo.
 *  force=true → abaikan cache (tombol "Cek Sinkronisasi"). */
function apiDemoStatus(force) {
  if (force) _bustCache(['sync_status']);
  const s = _syncStatus();
  return { ok: true, demoActive: !s.synced, syncStatus: s };
}

function apiLogout(token) {
  try { const u = _getSession(token); _audit(u.username, 'LOGOUT', 'Logout'); } catch (e) {}
  CacheService.getScriptCache().remove('sess_' + token);
  return { ok: true };
}

/* ======================= BOOTSTRAP DATA ======================== */
function _safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
function _menuTree() {
  // Sheet MENU_SETTINGS: IdParent=NULL → menu utama; IdParent=IdMenu lain → SUBMENU
  const all = _rows(SHEETS.MENU)
    .filter(m => String(m.IsActive).toUpperCase() === 'TRUE')
    .sort((a, b) => _num(a.OrderIndex) - _num(b.OrderIndex));
  const isRoot = m => !m.IdParent || String(m.IdParent).trim().toUpperCase() === 'NULL' || String(m.IdParent).trim() === '';
  const roots = all.filter(isRoot)
    .map(m => ({ id: String(m.IdMenu).trim(), name: String(m.MenuName).trim(), route: m.RoutePath }));
  const submenus = {};
  all.filter(m => !isRoot(m)).forEach(c => {
    const p = roots.find(r => r.id === String(c.IdParent).trim());
    if (p) (submenus[p.name] = submenus[p.name] || []).push(String(c.MenuName).trim());
  });
  return { roots: roots, submenus: submenus };
}
function _bootstrap(user) {
  // _safe(): sheet yang belum ada tidak boleh menggagalkan login (mode demo)
  const tree = _safe(() => _cached('menutree', _menuTree),
    { roots: user.menus.map(n => ({ id: n, name: n, route: '' })), submenus: {} });
  const menus = tree.roots;
  const divisi = _safe(() => _cached('divisi', () => _rows(SHEETS.DIVISI).map(d => ({
    idDivisi: String(d.IdDivisi).trim(), divisi: String(d.Divisi).trim(),
    subDivisi: String(d.SubDivisi).trim(), idSubdiv: String(d.IdSubdiv).trim(),
    idManager: String(d.IdManager).trim()
  }))), []);
  const karyawan = _safe(() => _cached('karyawan', () => _rows(SHEETS.KARYAWAN)
    .filter(k => String(k.Status).toUpperCase() === 'AKTIF')
    .map(k => ({
      nik: String(k.Nik).trim(), id: String(k.IdKaryawan).trim(),
      nama: String(k.NamaKaryawan).trim(), divisi: String(k.Divisi).trim(),
      subDivisi: String(k.SubDivisi).trim(), jabatan: String(k.Jabatan).trim()
    }))), []);
  // Akses menu user: pencocokan TOLERAN (kapital/spasi bebas)
  const userMenusNorm = user.menus.map(n => _norm(n));
  const allowed = menus.filter(m => userMenusNorm.indexOf(_norm(m.name)) > -1);
  const submenus = tree.submenus || {};
  // SUBMENU SETTINGS DIPAKSA STANDAR (sama dgn mode demo):
  // Umum & User · Data Karyawan · Master Data · Sinkronisasi.
  // Baris submenu custom di sheet MENU_SETTINGS utk Settings DIABAIKAN
  // karena halamannya built-in aplikasi (mencegah submenu liar seperti
  // "SETTINGS ROLE", "SETTINGS GEMINI LLM", dst).
  const settingsRoot = allowed.find(m => _norm(m.name).indexOf('SETTING') > -1);
  if (settingsRoot) {
    submenus[settingsRoot.name] = ['Umum & User', 'Data Karyawan', 'Master Data', 'Sinkronisasi'];
  }
  return {
    menus: allowed,
    submenus: submenus,
    divisi: divisi, karyawan: karyawan,
    rates: _getRates(),
    jenisLembur: ['KIRIMAN', 'BONGKARAN', 'STOCK OPNAME', 'REPACK', 'LAIN-LAIN']
  };
}
function apiBootstrap(token) {
  const user = _getSession(token);
  return { ok: true, user: user, bootstrap: _bootstrap(user) };
}

/* ========================= RATE LEMBUR ========================= */
function _getRates() {
  const p = PropertiesService.getScriptProperties();
  return {
    firstHour: _num(p.getProperty('RATE_FIRST') || 20000),
    nextHour: _num(p.getProperty('RATE_NEXT') || 15000)
  };
}
function apiSaveRates(token, rates) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const p = PropertiesService.getScriptProperties();
  p.setProperty('RATE_FIRST', String(_num(rates.firstHour)));
  p.setProperty('RATE_NEXT', String(_num(rates.nextHour)));
  _audit(user.username, 'SETTINGS_UPDATE', 'Update rate lembur: ' + JSON.stringify(rates));
  return { ok: true, rates: _getRates() };
}
function _calcNominal(durasi) {
  const r = _getRates();
  if (durasi <= 0) return 0;
  return r.firstHour + Math.max(0, durasi - 1) * r.nextHour;
}

/* ====================== SUBMIT OT (FORM) ======================= */
function apiSubmitOT(token, payload) {
  const user = _getSession(token);
  _requireMenu(user, 'Form OT');
  if (!payload || !payload.subDivisi || !payload.tanggalLembur || !payload.jenisLembur)
    throw new Error('Data header tidak lengkap');
  const rows = payload.rows || [];
  if (!rows.length) throw new Error('Minimal 1 karyawan harus diisi');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // ID divisi dari subdivisi
    const div = _rows(SHEETS.DIVISI).find(d => String(d.SubDivisi).trim().toUpperCase() === String(payload.subDivisi).trim().toUpperCase());
    const idDivisi = div ? String(div.IdDivisi).trim() : 'HO';

    // Generate IdDok sequential: OT/{DIV}/{YYYY}/{MM}/{NNNNNN}
    const now = new Date();
    const yyyy = now.getFullYear(), mm = ('0' + (now.getMonth() + 1)).slice(-2);
    const prefix = 'OT/' + idDivisi + '/' + yyyy + '/';
    const headers = _rows(SHEETS.HEADER);
    let maxSeq = 0;
    headers.forEach(h => {
      const id = String(h.IdDok || '');
      if (id.indexOf(prefix) === 0) {
        const seq = parseInt(id.split('/').pop(), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
    const idDok = prefix + mm + '/' + ('000000' + (maxSeq + 1)).slice(-6);

    // Hitung detail
    let totalDurasi = 0, totalNominal = 0;
    const today = _fmtDate(now);
    const detailRows = rows.map(r => {
      const durasi = _num(r.durasi);
      const nominal = _calcNominal(durasi);
      totalDurasi += durasi; totalNominal += nominal;
      return [idDok, today, payload.tanggalLembur, user.fullName,
        payload.lokasiLembur || payload.subDivisi, payload.subDivisi,
        payload.jenisLembur, r.nama, r.id, r.jabatan, r.jamMulai, r.jamSelesai,
        durasi, _rp(nominal), 'PENDING', payload.alasan || '', ''];
    });

    _sheet(SHEETS.HEADER).appendRow([idDok, payload.tanggalLembur, user.fullName,
      payload.subDivisi, payload.jenisLembur, rows.length, totalDurasi, _rp(totalNominal), 'PENDING']);
    const shD = _sheet(SHEETS.DETAIL);
    shD.getRange(shD.getLastRow() + 1, 1, detailRows.length, detailRows[0].length).setValues(detailRows);

    _audit(user.username, 'SUBMIT_OT', idDok + ' | ' + payload.subDivisi + ' | ' + rows.length + ' karyawan | ' + _rp(totalNominal));
    return { ok: true, idDok: idDok, totalNominal: _rp(totalNominal), totalDurasi: totalDurasi };
  } finally {
    lock.releaseLock();
  }
}

/* ========================= OT HISTORY ========================== */
/** Normalisasi utk perbandingan nama: trim, spasi ganda → tunggal, uppercase. */
function _norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase(); }
/** Cocokkan 2 nama dgn toleransi typo ringan (mis. RIZKI vs RIZKY):
 *  sama persis setelah normalisasi, ATAU ≥80% kata sama. */
function _nameMatch(a, b) {
  a = _norm(a); b = _norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = a.split(' '), wb = b.split(' ');
  if (Math.abs(wa.length - wb.length) > 1) return false;
  let hit = 0;
  wa.forEach(w => {
    if (wb.some(x => x === w || (w.length > 3 && x.length > 3 && (x.indexOf(w.slice(0, -1)) === 0 || w.indexOf(x.slice(0, -1)) === 0)))) hit++;
  });
  return hit >= Math.max(1, Math.ceil(Math.max(wa.length, wb.length) * 0.8));
}
function _visibleHeaders(user) {
  const headers = _rows(SHEETS.HEADER);
  const role = _norm(user.role);
  if (role === 'ADMIN') return headers;
  if (role === 'MANAGER') {
    // Manager: dokumen divisi yang dia kelola (APPROVAL_ROLE + DIVISI_ROLE.IdManager) + miliknya
    const myIds = _managerKaryawanIds(user);
    const myDivisi = _managerDivisiIds(myIds);
    const divMap = {}, mgrMap = {};
    _rows(SHEETS.DIVISI).forEach(d => {
      divMap[_norm(d.SubDivisi)] = String(d.IdDivisi).trim();
      mgrMap[_norm(d.SubDivisi)] = String(d.IdManager).trim();
    });
    return headers.filter(h => {
      const sub = _norm(h.SubDivisi);
      return myDivisi.includes(divMap[sub]) ||
        myIds.includes(mgrMap[sub]) ||
        _nameMatch(h.NamaPeminta, user.fullName);
    });
  }
  // USER: dokumen miliknya (toleran typo/spasi) — fallback: cocokkan username
  return headers.filter(h =>
    _nameMatch(h.NamaPeminta, user.fullName) ||
    _norm(h.NamaPeminta) === _norm(user.username));
}
function _managerKaryawanIds(user) {
  // IdKaryawan manager via DATA_KARYAWAN (match nama toleran ATAU username)
  return _rows(SHEETS.KARYAWAN)
    .filter(k => _nameMatch(k.NamaKaryawan, user.fullName) || _norm(k.NamaKaryawan) === _norm(user.username))
    .map(k => String(k.IdKaryawan).trim());
}
function _managerDivisiIds(myIds) {
  return _rows(SHEETS.APPROVAL)
    .filter(a => myIds.includes(String(a.IdApproval).trim()))
    .map(a => String(a.IdDivisi).trim());
}

function apiHistory(token, filters) {
  const user = _getSession(token);
  _requireMenu(user, 'OT History');
  filters = filters || {};
  let data = _visibleHeaders(user).map(h => ({
    idDok: String(h.IdDok), tanggal: _fmtDate(h.TanggalLembur),
    peminta: String(h.NamaPeminta), subDivisi: String(h.SubDivisi),
    jenis: String(h.JenisLembur), totalKaryawan: _num(h.TotalKaryawan),
    totalDurasi: _num(h.TotalDurasi), totalNominal: String(h.TotalNominal),
    status: String(h.StatusDokumen).trim().toUpperCase()
  }));
  if (filters.status) data = data.filter(d => d.status === filters.status);
  if (filters.q) {
    const q = filters.q.toUpperCase();
    data = data.filter(d => (d.idDok + d.peminta + d.subDivisi + d.jenis).toUpperCase().includes(q));
  }
  data.sort((a, b) => b.idDok.localeCompare(a.idDok));
  const page = Math.max(1, _num(filters.page) || 1), size = 10;
  return {
    ok: true, total: data.length, page: page, pages: Math.ceil(data.length / size),
    rows: data.slice((page - 1) * size, page * size)
  };
}

function apiDocDetail(token, idDok) {
  const user = _getSession(token);
  const details = _rows(SHEETS.DETAIL)
    .filter(d => String(d.IdDok).trim() === String(idDok).trim())
    .map(d => ({
      nama: String(d.NamaKaryawan), id: String(d.IdKaryawan), jabatan: String(d.Jabatan),
      jamMulai: String(d.JamMulai), jamSelesai: String(d.JamSelesai),
      durasi: _num(d.DurasiLembur), nominal: String(d.Nominal),
      alasan: String(d.AlasanLembur || ''), catatan: String(d.CatatanManager || ''),
      tanggalPengajuan: _fmtDate(d.TanggalPengajuan), tanggalLembur: _fmtDate(d.TanggalLembur),
      lokasi: String(d.LokasiLembur || '')
    }));
  return { ok: true, idDok: idDok, details: details };
}

/* ========================== APPROVAL =========================== */
function apiApprovalQueue(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Approval');
  let data = _visibleHeaders(user).filter(h => String(h.StatusDokumen).trim().toUpperCase() === 'PENDING');
  return {
    ok: true,
    rows: data.map(h => ({
      idDok: String(h.IdDok), tanggal: _fmtDate(h.TanggalLembur),
      peminta: String(h.NamaPeminta), subDivisi: String(h.SubDivisi),
      jenis: String(h.JenisLembur), totalKaryawan: _num(h.TotalKaryawan),
      totalDurasi: _num(h.TotalDurasi), totalNominal: String(h.TotalNominal)
    }))
  };
}

function _setDocStatus(idDok, status, catatan, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const shH = _sheet(SHEETS.HEADER);
    const vH = shH.getDataRange().getValues();
    const headH = vH[0].map(h => String(h).trim());
    const colId = _colIdx(headH, 'IdDok'), colSt = _colIdx(headH, 'StatusDokumen');
    let found = false;
    for (let i = 1; i < vH.length; i++) {
      if (String(vH[i][colId]).trim() === String(idDok).trim()) {
        shH.getRange(i + 1, colSt + 1).setValue(status);
        found = true; break;
      }
    }
    if (!found) throw new Error('Dokumen tidak ditemukan: ' + idDok);

    const shD = _sheet(SHEETS.DETAIL);
    const vD = shD.getDataRange().getValues();
    const headD = vD[0].map(h => String(h).trim());
    const dId = _colIdx(headD, 'IdDok'), dSt = _colIdx(headD, 'StatusDokumen'), dCt = _colIdx(headD, 'CatatanManager');
    for (let i = 1; i < vD.length; i++) {
      if (String(vD[i][dId]).trim() === String(idDok).trim()) {
        shD.getRange(i + 1, dSt + 1).setValue(status);
        if (catatan) shD.getRange(i + 1, dCt + 1).setValue(catatan);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function apiApprove(token, idDok, catatan) {
  const user = _getSession(token);
  _requireMenu(user, 'Approval');
  _setDocStatus(idDok, 'APPROVED', catatan || '', user);
  _audit(user.username, 'APPROVE', idDok + (catatan ? ' | ' + catatan : ''));
  return { ok: true };
}
function apiReject(token, idDok, catatan) {
  const user = _getSession(token);
  _requireMenu(user, 'Approval');
  if (!catatan) throw new Error('Catatan wajib diisi saat menolak dokumen');
  _setDocStatus(idDok, 'REJECTED', catatan, user);
  _audit(user.username, 'REJECT', idDok + ' | ' + catatan);
  return { ok: true };
}
function apiRevisi(token, idDok, catatan) {
  const user = _getSession(token);
  _requireMenu(user, 'Approval');
  if (!catatan) throw new Error('Catatan wajib diisi saat meminta revisi');
  _setDocStatus(idDok, 'REVISI', catatan, user);
  _audit(user.username, 'REVISI', idDok + ' | ' + catatan);
  return { ok: true };
}
function apiCancel(token, idDok) {
  const user = _getSession(token);
  const h = _rows(SHEETS.HEADER).find(x => String(x.IdDok).trim() === String(idDok).trim());
  if (!h) throw new Error('Dokumen tidak ditemukan');
  const isOwner = String(h.NamaPeminta).trim().toUpperCase() === user.fullName.toUpperCase();
  if (!isOwner && user.role !== 'ADMIN') throw new Error('Hanya pengaju atau Admin yang dapat membatalkan');
  if (String(h.StatusDokumen).trim().toUpperCase() !== 'PENDING') throw new Error('Hanya dokumen PENDING yang dapat dibatalkan');
  _setDocStatus(idDok, 'CANCELLED', 'Dibatalkan oleh ' + user.fullName, user);
  _audit(user.username, 'CANCEL', idDok);
  return { ok: true };
}

/* ========================== DASHBOARD ========================== */
function apiDashboard(token) {
  const user = _getSession(token);
  const headers = _visibleHeaders(user);
  const kpi = { total: 0, pending: 0, approved: 0, rejected: 0, totalDurasi: 0, totalNominal: 0 };
  const byMonth = {}, byStatus = {}, byJenis = {};
  headers.forEach(h => {
    const st = String(h.StatusDokumen).trim().toUpperCase();
    kpi.total++;
    if (st === 'PENDING') kpi.pending++;
    if (st === 'APPROVED') kpi.approved++;
    if (st === 'REJECTED') kpi.rejected++;
    kpi.totalDurasi += _num(h.TotalDurasi);
    kpi.totalNominal += _num(h.TotalNominal);
    const m = _fmtDate(h.TanggalLembur).slice(0, 7) || 'N/A';
    byMonth[m] = (byMonth[m] || 0) + _num(h.TotalDurasi);
    byStatus[st] = (byStatus[st] || 0) + 1;
    const j = String(h.JenisLembur).trim() || 'LAIN';
    byJenis[j] = (byJenis[j] || 0) + 1;
  });
  // Top karyawan dari detail
  const visible = new Set(headers.map(h => String(h.IdDok).trim()));
  const byKar = {};
  _rows(SHEETS.DETAIL).forEach(d => {
    if (!visible.has(String(d.IdDok).trim())) return;
    const k = String(d.NamaKaryawan).trim();
    byKar[k] = (byKar[k] || 0) + _num(d.DurasiLembur);
  });
  const topKar = Object.entries(byKar).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(e => ({ nama: e[0], jam: e[1] }));
  return { ok: true, kpi: kpi, byMonth: byMonth, byStatus: byStatus, byJenis: byJenis, topKaryawan: topKar };
}

/* =========================== REPORT ============================ */
function apiReport(token, groupBy) {
  const user = _getSession(token);
  _requireMenu(user, 'Report');
  const headers = _visibleHeaders(user);
  const keyFn = {
    subdivisi: h => String(h.SubDivisi).trim(),
    jenis: h => String(h.JenisLembur).trim(),
    bulan: h => _fmtDate(h.TanggalLembur).slice(0, 7),
    status: h => String(h.StatusDokumen).trim().toUpperCase()
  }[groupBy || 'subdivisi'] || (h => String(h.SubDivisi).trim());
  const agg = {};
  headers.forEach(h => {
    const k = keyFn(h) || 'N/A';
    if (!agg[k]) agg[k] = { key: k, dok: 0, karyawan: 0, durasi: 0, nominal: 0 };
    agg[k].dok++; agg[k].karyawan += _num(h.TotalKaryawan);
    agg[k].durasi += _num(h.TotalDurasi); agg[k].nominal += _num(h.TotalNominal);
  });
  _audit(user.username, 'EXPORT', 'Generate report by ' + (groupBy || 'subdivisi'));
  return { ok: true, rows: Object.values(agg).sort((a, b) => b.nominal - a.nominal) };
}

/* ========================== AUDIT LOG ========================== */
function _audit(user, action, details) {
  try {
    _sheet(SHEETS.AUDIT).appendRow([_fmtTs(new Date()), user, action, details]);
  } catch (e) { /* never block main flow */ }
}
function apiAuditLog(token, page) {
  const user = _getSession(token);
  _requireMenu(user, 'Audit Log');
  const rows = _rows(SHEETS.AUDIT).map(r => ({
    ts: r.Timestamp instanceof Date ? _fmtTs(r.Timestamp) : String(r.Timestamp),
    user: String(r.User), action: String(r.Action), details: String(r.Details)
  })).reverse();
  const p = Math.max(1, _num(page) || 1), size = 15;
  return { ok: true, total: rows.length, page: p, pages: Math.ceil(rows.length / size), rows: rows.slice((p - 1) * size, p * size) };
}

/* ===================== SETTINGS: USER CRUD ===================== */
function apiUsers(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  return {
    ok: true,
    rows: _rows(SHEETS.USER).map(u => ({
      username: String(u.Username).trim(), fullName: String(u.FullName).trim(),
      role: String(u.Role).trim(), aksesMenu: String(u.AksesMenu).trim()
    }))
  };
}
function apiSaveUser(token, data, isNew) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const sh = _sheet(SHEETS.USER);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const cU = _colIdx(head, 'Username');
  const uname = String(data.username).trim().toUpperCase();
  let rowIdx = -1;
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][cU]).trim().toUpperCase() === uname) { rowIdx = i + 1; break; }
  }
  const rowVals = [data.username, data.password, data.fullName, data.role, data.aksesMenu];
  if (uname === DEMO_ADMIN.username) throw new Error('Username DEMO dicadangkan sistem');
  if (isNew) {
    if (rowIdx > -1) throw new Error('Username sudah ada');
    sh.appendRow(rowVals);
    _audit(user.username, 'USER_CREATE', uname + ' (' + data.role + ')');
  } else {
    if (rowIdx === -1) throw new Error('User tidak ditemukan');
    if (!data.password) rowVals[1] = v[rowIdx - 1][_colIdx(head, 'Password')]; // keep old pwd
    sh.getRange(rowIdx, 1, 1, 5).setValues([rowVals]);
    _audit(user.username, 'USER_UPDATE', uname);
  }
  _bustCache(['sync_status']); // user resmi bertambah → demo bisa langsung nonaktif
  return { ok: true, demoActive: _demoActive() };
}
function apiDeleteUser(token, username) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  if (String(username).trim().toUpperCase() === user.username.toUpperCase()) throw new Error('Tidak bisa menghapus akun sendiri');
  const sh = _sheet(SHEETS.USER);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const cU = _colIdx(head, 'Username');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][cU]).trim().toUpperCase() === String(username).trim().toUpperCase()) {
      sh.deleteRow(i + 1);
      _audit(user.username, 'USER_DELETE', username);
      _bustCache(['sync_status']);
      return { ok: true };
    }
  }
  throw new Error('User tidak ditemukan');
}

/* ================= SETTINGS: SINKRONISASI ======================
   Admin memasukkan URL (Spreadsheet / Web App) agar seluruh sheet
   terkoneksi dengan aplikasi. ID disimpan di Script Properties
   (SS_ID_OVERRIDE) — tanpa redeploy. ============================ */
function _sheetChecklist() {
  const required = [
    { key: SHEETS.USER, desc: 'User & role login' },
    { key: SHEETS.MENU, desc: 'Menu & submenu dinamis' },
    { key: SHEETS.APPROVAL, desc: 'Matriks approval' },
    { key: SHEETS.DIVISI, desc: 'Master divisi/sub divisi' },
    { key: SHEETS.KARYAWAN, desc: 'Master karyawan' },
    { key: SHEETS.HEADER, desc: 'Dokumen lembur (header)' },
    { key: SHEETS.DETAIL, desc: 'Rincian lembur per karyawan' },
    { key: SHEETS.REPORT, desc: 'Output report (opsional)' },
    { key: SHEETS.AUDIT, desc: 'Audit trail' }
  ];
  return required.map(r => {
    let sh = null;
    try { sh = _sheet(r.key); } catch (e) { /* tidak ada */ }
    return {
      sheet: r.key, desc: r.desc,
      exists: !!sh,
      rows: sh ? Math.max(0, sh.getLastRow() - 1) : 0,
      optional: r.key === SHEETS.REPORT
    };
  });
}

function apiSyncInfo(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const p = PropertiesService.getScriptProperties();
  let ssName = '', ssUrl = '', connected = false, checklist = [];
  try {
    const ss = _ss();
    ssName = ss.getName(); ssUrl = ss.getUrl(); connected = true;
    checklist = _sheetChecklist();
  } catch (e) { /* spreadsheet tidak terjangkau */ }
  const requiredOk = checklist.filter(c => !c.optional && c.exists).length;
  const requiredAll = checklist.filter(c => !c.optional).length || 8;
  return {
    ok: true,
    connected: connected,
    ssId: _activeSsId(),
    isOverride: !!p.getProperty('SS_ID_OVERRIDE'),
    ssName: ssName, ssUrl: ssUrl,
    webAppUrl: p.getProperty('WEBAPP_URL') || _safe(() => ScriptApp.getService().getUrl(), '') || '',
    checklist: checklist,
    synced: connected && requiredOk === requiredAll,
    demoActive: _demoActive()
  };
}

function apiSyncConnect(token, input, webAppUrl) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const p = PropertiesService.getScriptProperties();
  // simpan Web App URL (referensi utk share/QR) bila diisi
  if (webAppUrl !== undefined && webAppUrl !== null) {
    const w = String(webAppUrl).trim();
    if (w && !/^https:\/\/script\.google\.com\//.test(w))
      throw new Error('Web App URL tidak valid (harus diawali https://script.google.com/)');
    if (w) p.setProperty('WEBAPP_URL', w); else p.deleteProperty('WEBAPP_URL');
  }
  // koneksikan spreadsheet bila URL/ID diisi
  if (input && String(input).trim()) {
    const id = _extractSsId(input);
    if (!id) throw new Error('URL/ID Spreadsheet tidak valid');
    let ss;
    try { ss = SpreadsheetApp.openById(id); }
    catch (e) { throw new Error('Spreadsheet tidak dapat diakses. Pastikan akun deploy punya izin: ' + e.message); }
    p.setProperty('SS_ID_OVERRIDE', id);
    _bustCache(['sync_status', 'menus', 'menutree', 'divisi', 'karyawan']);
    _audit(user.username, 'SYNC_CONNECT', 'Terkoneksi ke spreadsheet: ' + ss.getName() + ' (' + id + ')');
  }
  return apiSyncInfo(token);
}

function apiSyncReset(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  PropertiesService.getScriptProperties().deleteProperty('SS_ID_OVERRIDE');
  _bustCache(['sync_status', 'menus', 'menutree', 'divisi', 'karyawan']);
  _audit(user.username, 'SYNC_RESET', 'Kembali ke spreadsheet default');
  return apiSyncInfo(token);
}

function apiSyncTest(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  _bustCache(['sync_status', 'menus', 'menutree', 'divisi', 'karyawan']);
  _audit(user.username, 'SYNC_TEST', 'Tes koneksi & refresh cache');
  return apiSyncInfo(token);
}

/** DIAGNOSA: tampilkan apa yang benar2 terbaca aplikasi dari tiap
 *  sheet — nama sheet asli, header asli vs kanonis, jumlah baris,
 *  dan sampel baris pertama. Untuk debug "data tidak muncul". */
function apiDiagnose(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const keys = [SHEETS.USER, SHEETS.MENU, SHEETS.APPROVAL, SHEETS.DIVISI,
    SHEETS.KARYAWAN, SHEETS.HEADER, SHEETS.DETAIL, SHEETS.AUDIT];
  const out = keys.map(k => {
    try {
      const sh = _sheet(k);
      const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(h => String(h).trim());
      const rows = _rows(k);
      const sample = rows[0] || null;
      return {
        key: k, realName: sh.getName(), ok: true,
        rowCount: rows.length,
        headers: head.filter(Boolean),
        canonHeaders: head.filter(Boolean).map(h => CANON_MAP[_normName(h)] || ('? ' + h)),
        sample: sample ? JSON.stringify(sample).slice(0, 300) : '(kosong)'
      };
    } catch (e) {
      return { key: k, realName: '-', ok: false, rowCount: 0, headers: [], canonHeaders: [], sample: 'ERROR: ' + e.message };
    }
  });
  return { ok: true, sheets: out, ssId: _activeSsId() };
}

/* ============== SETTINGS: DATA KARYAWAN (CRUD) =================
   Soft delete: data tidak pernah dihapus dari sheet — kolom
   Status diubah AKTIF ⇄ RESIGN. Karyawan RESIGN otomatis hilang
   dari autocomplete Form OT (bootstrap memfilter Status=AKTIF). */
function apiKaryawanList(token, filters) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  filters = filters || {};
  let rows = _rows(SHEETS.KARYAWAN).map(k => ({
    nik: String(k.Nik).trim(), id: String(k.IdKaryawan).trim(),
    nama: String(k.NamaKaryawan).trim(), divisi: String(k.Divisi).trim(),
    subDivisi: String(k.SubDivisi).trim(), jabatan: String(k.Jabatan).trim(),
    status: String(k.Status).trim().toUpperCase() || 'AKTIF'
  }));
  if (filters.status) rows = rows.filter(r => r.status === String(filters.status).toUpperCase());
  if (filters.q) {
    const q = String(filters.q).toUpperCase();
    rows = rows.filter(r => (r.nik + r.id + r.nama + r.subDivisi + r.jabatan).toUpperCase().includes(q));
  }
  const page = Math.max(1, _num(filters.page) || 1), size = 10;
  return { ok: true, total: rows.length, page: page, pages: Math.max(1, Math.ceil(rows.length / size)), rows: rows.slice((page - 1) * size, page * size) };
}

function _findKaryawanRow(sh, idKaryawan) {
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const cId = _colIdx(head, 'IdKaryawan');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][cId]).trim() === String(idKaryawan).trim()) return { rowIdx: i + 1, head: head, vals: v[i] };
  }
  return null;
}

function apiSaveKaryawan(token, data, isNew) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  if (!data || !data.id || !data.nama) throw new Error('IdKaryawan dan Nama wajib diisi');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = _sheet(SHEETS.KARYAWAN);
    const found = _findKaryawanRow(sh, data.id);
    const rowVals = [data.nik || '', data.id, String(data.nama).toUpperCase(),
      data.divisi || '', data.subDivisi || '', data.jabatan || '',
      String(data.status || 'AKTIF').toUpperCase()];
    if (isNew) {
      if (found) throw new Error('IdKaryawan sudah terdaftar: ' + data.id);
      sh.appendRow(rowVals);
      _audit(user.username, 'KARYAWAN_CREATE', data.id + ' | ' + data.nama);
    } else {
      if (!found) throw new Error('Karyawan tidak ditemukan: ' + data.id);
      sh.getRange(found.rowIdx, 1, 1, 7).setValues([rowVals]);
      _audit(user.username, 'KARYAWAN_UPDATE', data.id + ' | ' + data.nama);
    }
    _bustCache(['karyawan']);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** SOFT DELETE: toggle Status AKTIF ⇄ RESIGN (baris tidak dihapus). */
function apiToggleKaryawan(token, idKaryawan) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const sh = _sheet(SHEETS.KARYAWAN);
  const found = _findKaryawanRow(sh, idKaryawan);
  if (!found) throw new Error('Karyawan tidak ditemukan: ' + idKaryawan);
  const cSt = _colIdx(found.head, 'Status');
  const cur = String(found.vals[cSt]).trim().toUpperCase();
  const next = cur === 'AKTIF' ? 'RESIGN' : 'AKTIF';
  sh.getRange(found.rowIdx, cSt + 1).setValue(next);
  _audit(user.username, next === 'RESIGN' ? 'KARYAWAN_RESIGN' : 'KARYAWAN_REAKTIF', idKaryawan);
  _bustCache(['karyawan']);
  return { ok: true, status: next };
}

/* ===== SETTINGS: MASTER DATA (MENU / APPROVAL ROLE / DIVISI ROLE) =====
   Menarik & mengelola data sheet MENU_SETTINGS, APPROVAL_ROLE,
   DIVISI_ROLE agar tampil di menu Settings setelah sinkronisasi. */
function apiMasterData(token) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const menus = _safe(() => _rows(SHEETS.MENU).map(m => ({
    idMenu: String(m.IdMenu).trim(), menuName: String(m.MenuName).trim(),
    idParent: (!m.IdParent || String(m.IdParent).trim().toUpperCase() === 'NULL') ? '' : String(m.IdParent).trim(),
    routePath: String(m.RoutePath || '').trim(), orderIndex: _num(m.OrderIndex),
    isActive: String(m.IsActive).trim().toUpperCase() === 'TRUE'
  })), []);
  const approvals = _safe(() => _rows(SHEETS.APPROVAL).map(a => ({
    idMatrix: String(a.IdMatrix).trim(), idDivisi: String(a.IdDivisi).trim(),
    approvalLevel: _num(a.ApprovalLevel), idApproval: String(a.IdApproval).trim()
  })), []);
  const divisi = _safe(() => _rows(SHEETS.DIVISI).map(d => ({
    idDivisi: String(d.IdDivisi).trim(), divisi: String(d.Divisi).trim(),
    subDivisi: String(d.SubDivisi).trim(), idSubdiv: String(d.IdSubdiv).trim(),
    idManager: String(d.IdManager).trim()
  })), []);
  return { ok: true, menus: menus, approvals: approvals, divisi: divisi };
}

/** Generic: cari baris berdasarkan nilai kolom kunci → rowIdx (1-based) atau -1. */
function _findRowByKey(sheetName, keyColName, keyVal) {
  const sh = _sheet(sheetName);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const c = head.indexOf(keyColName);
  if (c === -1) throw new Error('Kolom ' + keyColName + ' tidak ada di ' + sheetName);
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][c]).trim().toUpperCase() === String(keyVal).trim().toUpperCase()) return i + 1;
  }
  return -1;
}

/* ---- MENU_SETTINGS ---- */
function apiSaveMenu(token, d, isNew) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  if (!d || !d.idMenu || !d.menuName) throw new Error('IdMenu dan MenuName wajib diisi');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = _sheet(SHEETS.MENU);
    const rowIdx = _findRowByKey(SHEETS.MENU, 'IdMenu', d.idMenu);
    const vals = [d.idMenu, d.menuName, d.idParent ? d.idParent : 'NULL',
      d.routePath || '', _num(d.orderIndex) || 99, d.isActive ? 'TRUE' : 'FALSE'];
    if (isNew) {
      if (rowIdx > -1) throw new Error('IdMenu sudah ada: ' + d.idMenu);
      sh.appendRow(vals);
      _audit(user.username, 'MENU_CREATE', d.idMenu + ' | ' + d.menuName);
    } else {
      if (rowIdx === -1) throw new Error('Menu tidak ditemukan: ' + d.idMenu);
      sh.getRange(rowIdx, 1, 1, 6).setValues([vals]);
      _audit(user.username, 'MENU_UPDATE', d.idMenu + ' | ' + d.menuName);
    }
    _bustCache(['menus', 'menutree']);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
/** Soft delete menu: toggle IsActive TRUE ⇄ FALSE. */
function apiToggleMenu(token, idMenu) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const sh = _sheet(SHEETS.MENU);
  const rowIdx = _findRowByKey(SHEETS.MENU, 'IdMenu', idMenu);
  if (rowIdx === -1) throw new Error('Menu tidak ditemukan: ' + idMenu);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const c = _colIdx(head, 'IsActive') + 1;
  const cur = String(sh.getRange(rowIdx, c).getValue()).trim().toUpperCase() === 'TRUE';
  sh.getRange(rowIdx, c).setValue(cur ? 'FALSE' : 'TRUE');
  _audit(user.username, cur ? 'MENU_DISABLE' : 'MENU_ENABLE', idMenu);
  _bustCache(['menus', 'menutree']);
  return { ok: true, isActive: !cur };
}

/* ---- APPROVAL_ROLE ---- */
function apiSaveApproval(token, d, isNew) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  if (!d || !d.idMatrix || !d.idDivisi || !d.idApproval) throw new Error('IdMatrix, IdDivisi, IdApproval wajib diisi');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = _sheet(SHEETS.APPROVAL);
    const rowIdx = _findRowByKey(SHEETS.APPROVAL, 'IdMatrix', d.idMatrix);
    const vals = [d.idMatrix, d.idDivisi, _num(d.approvalLevel) || 1, d.idApproval];
    if (isNew) {
      if (rowIdx > -1) throw new Error('IdMatrix sudah ada: ' + d.idMatrix);
      sh.appendRow(vals);
      _audit(user.username, 'APPROVAL_CREATE', d.idMatrix + ' | ' + d.idDivisi + ' → ' + d.idApproval);
    } else {
      if (rowIdx === -1) throw new Error('Matrix tidak ditemukan: ' + d.idMatrix);
      sh.getRange(rowIdx, 1, 1, 4).setValues([vals]);
      _audit(user.username, 'APPROVAL_UPDATE', d.idMatrix);
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function apiDeleteApproval(token, idMatrix) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const sh = _sheet(SHEETS.APPROVAL);
  const rowIdx = _findRowByKey(SHEETS.APPROVAL, 'IdMatrix', idMatrix);
  if (rowIdx === -1) throw new Error('Matrix tidak ditemukan: ' + idMatrix);
  sh.deleteRow(rowIdx);
  _audit(user.username, 'APPROVAL_DELETE', idMatrix);
  return { ok: true };
}

/* ---- DIVISI_ROLE (kunci komposit IdDivisi+SubDivisi) ---- */
function _findDivisiRow(idDivisi, subDivisi) {
  const sh = _sheet(SHEETS.DIVISI);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const cD = _colIdx(head, 'IdDivisi'), cS = _colIdx(head, 'SubDivisi');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][cD]).trim().toUpperCase() === String(idDivisi).trim().toUpperCase() &&
        String(v[i][cS]).trim().toUpperCase() === String(subDivisi).trim().toUpperCase()) return i + 1;
  }
  return -1;
}
function apiSaveDivisi(token, d, isNew, origSubDivisi) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  if (!d || !d.idDivisi || !d.subDivisi) throw new Error('IdDivisi dan SubDivisi wajib diisi');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = _sheet(SHEETS.DIVISI);
    const vals = [d.idDivisi, d.divisi || '', d.subDivisi, d.idSubdiv || '', d.idManager || ''];
    if (isNew) {
      if (_findDivisiRow(d.idDivisi, d.subDivisi) > -1) throw new Error('Kombinasi divisi+sub divisi sudah ada');
      sh.appendRow(vals);
      _audit(user.username, 'DIVISI_CREATE', d.idDivisi + ' | ' + d.subDivisi);
    } else {
      const rowIdx = _findDivisiRow(d.idDivisi, origSubDivisi || d.subDivisi);
      if (rowIdx === -1) throw new Error('Data divisi tidak ditemukan');
      sh.getRange(rowIdx, 1, 1, 5).setValues([vals]);
      _audit(user.username, 'DIVISI_UPDATE', d.idDivisi + ' | ' + d.subDivisi);
    }
    _bustCache(['divisi']);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function apiDeleteDivisi(token, idDivisi, subDivisi) {
  const user = _getSession(token);
  _requireMenu(user, 'Settings');
  const rowIdx = _findDivisiRow(idDivisi, subDivisi);
  if (rowIdx === -1) throw new Error('Data divisi tidak ditemukan');
  _sheet(SHEETS.DIVISI).deleteRow(rowIdx);
  _audit(user.username, 'DIVISI_DELETE', idDivisi + ' | ' + subDivisi);
  _bustCache(['divisi']);
  return { ok: true };
}

/* ===================== DRIVE ATTACHMENT ======================== */
function apiUploadAttachment(token, idDok, base64, fileName, mimeType) {
  const user = _getSession(token);
  let root;
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  root = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
  const safe = String(idDok).replace(/[\/\\]/g, '_');
  const sub = root.getFoldersByName(safe);
  const folder = sub.hasNext() ? sub.next() : root.createFolder(safe);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  _audit(user.username, 'UPLOAD', idDok + ' | ' + fileName);
  return { ok: true, url: file.getUrl() };
}
