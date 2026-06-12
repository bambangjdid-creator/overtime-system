# 📘 BLUEPRINT PLAN — OVERTIME SYSTEM (OT-SYS)
### Web Application berbasis Google Drive + Google Sheets (Google Apps Script)

---

## 1. RINGKASAN EKSEKUTIF

| Item | Keterangan |
|---|---|
| Nama Aplikasi | **OVERTIME SYSTEM (OT-SYS)** |
| Platform | Google Apps Script Web App (gratis, hosted di Google Drive) |
| Database | Google Spreadsheet ID: `1MEx2dqHuV21QPVplJGgcX1obzvFuPgUqjbw1CkXpAMk` |
| Storage Lampiran | Google Drive Folder (auto-create `OT_ATTACHMENTS`) |
| Arsitektur | SPA (Single Page Application) — 1 file `index.html` + backend `Code.gs` |
| Pengguna | USER (pengaju), MANAGER (approver), ADMIN (full control) |
| Karakteristik | Dinamis · Responsif (mobile-first) · Scalable · Animatif · Profesional |

---

## 2. ARSITEKTUR SISTEM

```
┌─────────────────────────────────────────────────────────────┐
│                       BROWSER (Client)                       │
│  index.html — SPA: HTML + CSS (custom design system) + JS    │
│  · Hash Routing      · State Management   · Skeleton Loader  │
│  · SVG Charts        · Toast/Modal        · LocalStorage     │
└──────────────────────────┬──────────────────────────────────┘
                           │ google.script.run (async RPC)
┌──────────────────────────▼──────────────────────────────────┐
│              GOOGLE APPS SCRIPT (Server / Code.gs)           │
│  · Auth & Session    · RBAC (Role + AksesMenu)               │
│  · CRUD Engine       · ID Generator (IdDok sequential)       │
│  · Approval Workflow · Audit Logger     · CacheService       │
│  · LockService (anti race-condition / concurrent write)      │
└───────────┬──────────────────────────────┬──────────────────┘
            │                              │
┌───────────▼───────────────┐   ┌──────────▼──────────────────┐
│   GOOGLE SPREADSHEET (DB) │   │  GOOGLE DRIVE (File Store)  │
│   9 sheet = 9 "tabel"     │   │  /OT_ATTACHMENTS/{IdDok}/   │
└───────────────────────────┘   └─────────────────────────────┘
```

---

## 3. STRUKTUR DATABASE (mengikuti GSheet yang ada — 1:1)

### 3.1 `USER_ROLE` — Tabel autentikasi & otorisasi
| Kolom | Tipe | Keterangan |
|---|---|---|
| Username | string | unik, login key |
| Password | string | PIN/password |
| FullName | string | nama tampil |
| Role | enum | `ADMIN` / `MANAGER` / `USER` |
| AksesMenu | csv | mis. `Dashboard, Form OT, OT History, Approval, ...` |

### 3.2 `MENU_SETTINGS` — Menu dinamis
| Kolom | Contoh |
|---|---|
| IdMenu | M1..M7 |
| MenuName | Dashboard, Form OT, OT History, Approval, Audit Log, Report, Settings |
| IdParent | NULL (flat) |
| RoutePath | `/dashboard`, `/form-ot`, … |
| OrderIndex | 1..7 |
| IsActive | TRUE/FALSE |

### 3.3 `APPROVAL_ROLE` — Matriks approval per divisi
| Kolom | Contoh |
|---|---|
| IdMatrix | M001 |
| IdDivisi | DC / OPR / HO |
| ApprovalLevel | 1 / 2 / 3 |
| IdApproval | IdKaryawan manager (800002, 900025, 1000000) |

### 3.4 `DIVISI_ROLE` — Master divisi & sub-divisi
`IdDivisi · Divisi · SubDivisi · IdSubdiv · IdManager`

### 3.5 `DATA_KARYAWAN` — Master karyawan
`Nik · IdKaryawan · NamaKaryawan · Divisi · SubDivisi · Jabatan · Status (AKTIF/RESIGN)`

### 3.6 `OT_HEADER` — Dokumen lembur (1 baris = 1 dokumen)
`IdDok · TanggalLembur · NamaPeminta · SubDivisi · JenisLembur · TotalKaryawan · TotalDurasi · TotalNominal · StatusDokumen`

### 3.7 `OT_DETAIL` — Rincian per karyawan (N baris per dokumen)
`IdDok · TanggalPengajuan · TanggalLembur · NamaPeminta · LokasiLembur · SubDivisi · JenisLembur · NamaKaryawan · IdKaryawan · Jabatan · JamMulai · JamSelesai · DurasiLembur · Nominal · StatusDokumen · AlasanLembur · CatatanManager`

### 3.8 `REPORT` — Output pivot/agregasi (generated)
### 3.9 `AUDIT_LOG` — `Timestamp · User · Action · Details`

---

## 4. BUSINESS RULES

### 4.1 Penomoran Dokumen (IdDok)
Format: **`OT/{IdDivisi}/{YYYY}/{MM}/{NNNNNN}`** → contoh `OT/HO/2026/06/000007`
- Sequential, reset per kombinasi divisi+tahun, digenerate server-side dengan **LockService** agar bebas duplikasi saat submit bersamaan.

### 4.2 Kalkulasi Nominal Lembur (terverifikasi dari data eksisting)
> 2 jam = Rp 35.000 · 3,5 jam = Rp 57.500 ⇒ **Jam pertama Rp 20.000, jam berikutnya Rp 15.000/jam** (pro-rata per 0,5 jam). Rate dapat diubah Admin di menu **Settings** (disimpan di Script Properties).
```
Nominal = RATE_JAM_1 + max(0, Durasi - 1) × RATE_JAM_BERIKUT
Durasi  = JamSelesai - JamMulai (mendukung lembur lintas tengah malam)
```

### 4.3 Workflow Status Dokumen
```
DRAFT → PENDING → APPROVED   (oleh manager sesuai APPROVAL_ROLE matrix)
                → REJECTED   (wajib isi CatatanManager)
PENDING dapat di-CANCEL oleh pengaju sendiri / ADMIN
```
- Approver ditentukan: SubDivisi → DIVISI_ROLE → IdDivisi → APPROVAL_ROLE → IdApproval.
- MANAGER hanya melihat dokumen di divisinya; ADMIN melihat semua.

### 4.4 RBAC (Role-Based Access Control)
| Menu | USER | MANAGER | ADMIN |
|---|:-:|:-:|:-:|
| Dashboard | ✅ | ✅ | ✅ |
| Form OT | ✅ | ✅ | ✅ |
| OT History | ✅ (miliknya) | ✅ (divisinya) | ✅ (semua) |
| Approval | — | ✅ | ✅ |
| Audit Log | — | opsional* | ✅ |
| Report | — | ✅ | ✅ |
| Settings | — | — | ✅ |

\* mengikuti kolom `AksesMenu` di USER_ROLE — menu dirender **dinamis** dari sheet, bukan hard-coded.

### 4.5 Audit Trail
Setiap aksi tercatat otomatis: `LOGIN, LOGOUT, SUBMIT_OT, APPROVE, REJECT, CANCEL, USER_CREATE, USER_UPDATE, USER_DELETE, SETTINGS_UPDATE, EXPORT`.

---

## 5. MODUL & FITUR

| # | Modul | Fitur Utama |
|---|---|---|
| 1 | **Login** | Validasi USER_ROLE, animasi, show/hide password, remember-me (localStorage), audit LOGIN |
| 2 | **Dashboard** | KPI cards animasi counter (Total Dok, Pending, Approved, Total Jam, Total Nominal), grafik tren bulanan (SVG), donut status, top-5 karyawan, filter periode |
| 3 | **Form OT** | Header dokumen + tabel detail karyawan dinamis (add/remove row), autocomplete karyawan dari DATA_KARYAWAN, auto-hitung durasi & nominal real-time, validasi lengkap, ringkasan live |
| 4 | **OT History** | Tabel responsif: cari, filter status/tanggal, pagination, detail drawer per dokumen, cancel pending, **cetak SPL (Surat Perintah Lembur)** |
| 5 | **Approval** | Antrian pending sesuai matriks, detail lengkap, Approve / Reject + catatan, approve massal |
| 6 | **Audit Log** | Timeline aktivitas, filter user/aksi/tanggal |
| 7 | **Report** | Rekap per SubDivisi / Jenis / Karyawan / Bulan, export **CSV**, print-friendly |
| 8 | **Settings** | Kelola user (CRUD + akses menu), rate lembur, info sistem |

---

## 6. DESAIN UI/UX

- **Design System**: CSS Variables, font Plus Jakarta Sans/system, palet Indigo–Violet profesional + dark sidebar.
- **Layout**: Sidebar (desktop) → hamburger + drawer (mobile); konten max-width fluid; tabel → card di layar kecil.
- **Animasi**: page fade/slide transition, animated number counter, skeleton loading, ripple button, toast notification, progress bar, chart grow-in, modal spring.
- **Aksesibilitas**: kontras WCAG AA, focus ring, keyboard navigable.

---

## 7. SCALABILITY & PERFORMA

1. **CacheService** (TTL 5 menit) untuk master data (karyawan, divisi, menu) → kurangi pembacaan sheet.
2. **Batch read/write** — `getValues()` / `setValues()` sekali jalan, bukan per-cell.
3. **LockService** untuk penomoran dokumen & tulis konkuren.
4. **Pagination server-side** untuk history & audit log.
5. Frontend **mock-mode**: file yang sama bisa di-preview offline dengan data demo (otomatis aktif jika `google.script` tidak tersedia).

---

## 8. KEAMANAN

- Session token server-side (CacheService, expire 8 jam) — setiap RPC divalidasi.
- RBAC dicek ulang di server (bukan hanya disembunyikan di UI).
- Sanitasi input, validasi tipe & range di server.
- Audit log immutable (append-only).
- Rekomendasi: deploy "Execute as: Me" + "Anyone with link", sheet tidak perlu dibagikan publik.

---

## 9. STRUKTUR PROYEK

```
overtime-system/
├── BLUEPRINT.md            ← dokumen ini
├── apps-script/
│   ├── Code.gs             ← backend lengkap (deploy ke Apps Script)
│   └── index.html          ← frontend SPA (deploy ke Apps Script)
└── README-DEPLOY.md        ← panduan deployment langkah demi langkah
```

---

## 10. ROADMAP IMPLEMENTASI

| Fase | Deliverable | Status |
|---|---|---|
| 1 | Blueprint & pemetaan struktur GSheet | ✅ |
| 2 | Backend Code.gs (auth, CRUD, workflow, audit, report) | ✅ |
| 3 | Frontend SPA (8 modul, responsif, animasi) | ✅ |
| 4 | Mock-mode demo untuk preview | ✅ |
| 5 | Panduan deployment | ✅ |
| 6 | (Opsional) Notifikasi email approval, PWA, multi-level approval berantai | ⏭ next |
