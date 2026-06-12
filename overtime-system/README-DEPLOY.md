# 🚀 PANDUAN DEPLOYMENT — OVERTIME SYSTEM (OT-SYS)
### Google Apps Script + Google Sheets + Google Drive

---

## A. Persiapan Spreadsheet

Aplikasi menggunakan spreadsheet yang sudah ada:
`https://docs.google.com/spreadsheets/d/1MEx2dqHuV21QPVplJGgcX1obzvFuPgUqjbw1CkXpAMk`

Pastikan 9 sheet ini ada (sudah sesuai struktur Anda — tidak perlu diubah):

| Sheet | Fungsi |
|---|---|
| `USER_ROLE` | Username, Password, FullName, Role, AksesMenu |
| `MENU_SETTINGS` | IdMenu, MenuName, IdParent, RoutePath, OrderIndex, IsActive — **mendukung submenu** via `IdParent` |
| `APPROVAL_ROLE` | IdMatrix, IdDivisi, ApprovalLevel, IdApproval |
| `DIVISI_ROLE` | IdDivisi, Divisi, SubDivisi, IdSubdiv, IdManager |
| `DATA_KARYAWAN` | Nik, IdKaryawan, NamaKaryawan, Divisi, SubDivisi, Jabatan, Status |
| `OT_HEADER` | IdDok … StatusDokumen |
| `OT_DETAIL` | IdDok … CatatanManager |
| `REPORT` | (pivot — opsional, report digenerate aplikasi) |
| `AUDIT_LOG` | Timestamp, User, Action, Details |

> ⚠️ Penting: header harus tepat di **baris 1** setiap sheet.

### Submenu Settings (sheet `MENU_SETTINGS`)

Submenu dibaca dinamis dari sheet: baris dengan `IdParent` = IdMenu induk menjadi **submenu**. Tambahkan 2 baris ini agar menu Settings memiliki submenu:

| IdMenu | MenuName | IdParent | RoutePath | OrderIndex | IsActive |
|---|---|---|---|---|---|
| M7A | Umum & User | **M7** | /settings/umum | 1 | TRUE |
| M7B | Data Karyawan | **M7** | /settings/karyawan | 2 | TRUE |
| M7C | Master Data | **M7** | /settings/master | 3 | TRUE |
| M7D | Sinkronisasi | **M7** | /settings/sinkronisasi | 4 | TRUE |

**Settings › Master Data** menarik & mengelola 3 sheet hasil sinkronisasi dalam tab terpisah:
- **Menu Settings** (`MENU_SETTINGS`) — tambah/edit + soft delete via toggle `IsActive`
- **Approval Role** (`APPROVAL_ROLE`) — tambah/edit/hapus matriks approval per divisi
- **Divisi Role** (`DIVISI_ROLE`) — tambah/edit/hapus divisi & sub divisi (kunci komposit IdDivisi+SubDivisi)

(M7 = IdMenu baris "Settings"). Tanpa baris ini, Settings tampil sebagai menu tunggal seperti biasa.

---

## B. Langkah Deploy (±5 menit)

1. **Buka spreadsheet** → menu **Extensions → Apps Script**.
2. Di editor Apps Script:
   - Ganti seluruh isi `Code.gs` dengan file **`apps-script/Code.gs`**.
   - Klik **+ (Files) → HTML**, beri nama **`index`**, ganti isinya dengan file **`apps-script/index.html`**.
3. Klik ikon **Save** (💾).
4. Klik **Deploy → New deployment**:
   - Type: **Web app**
   - Description: `OT-SYS v1.0`
   - Execute as: **Me** (akun Anda — pemilik sheet)
   - Who has access: **Anyone** (atau "Anyone in organization" untuk Workspace)
5. Klik **Deploy** → **Authorize access** → pilih akun → Allow.
6. Salin **Web app URL** → itulah alamat aplikasi Anda. 🎉

### Update versi berikutnya
Setelah edit kode: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (URL tetap sama).

---

## C. User Demo Bawaan (Setup Mode)

| Username | Password | Role |
|---|---|---|
| **DEMO** | **DEMO123** | ADMIN (fallback) |

**Flow otomatis:**
1. Saat sheet **belum tersinkronisasi** (ada sheet wajib yang hilang ATAU `USER_ROLE` belum berisi user valid) → halaman login menampilkan hint **SETUP MODE** dan akun `DEMO/DEMO123` bisa dipakai untuk masuk sebagai Admin guna menyiapkan sistem.
2. Begitu **semua 8 sheet wajib ada + minimal 1 user valid** di `USER_ROLE` → user DEMO **otomatis dinonaktifkan & disembunyikan**:
   - hint di halaman login hilang,
   - login `DEMO` ditolak ("Username atau password salah"),
   - sesi DEMO yang masih aktif langsung digugurkan pada request berikutnya.
3. Status sinkronisasi di-cache 5 menit; menambah/menghapus user via menu Settings langsung me-refresh status. Username `DEMO` dicadangkan sistem (tidak bisa dibuat di Settings).
4. Di **mode preview** (file dibuka tanpa Apps Script) tersedia tombol *"Simulasi: Tandai Sheet Tersinkronisasi"* pada banner kuning untuk menguji flow ini.

> 🔐 Keamanan: ganti konstanta `DEMO_ADMIN.password` di `Code.gs` sebelum deploy bila perlu.

---

## D. Login Awal

| Username | Password | Role |
|---|---|---|
| IRAWAN | 609215 | ADMIN |
| BAMBANG | 609215 | MANAGER |
| TUTI | 111111 | USER |

(semua sesuai sheet `USER_ROLE` — kelola via menu **Settings** di aplikasi)

---

## E. Sinkronisasi (Settings › Sinkronisasi)

Menu untuk **menghubungkan aplikasi dengan spreadsheet & Web App URL** tanpa menyentuh kode:

1. **URL/ID Google Spreadsheet** — tempel URL lengkap atau ID-nya. Aplikasi akan langsung membaca semua sheet (USER_ROLE, OT_HEADER, dst.) dari spreadsheet tersebut. ID tersimpan di Script Properties (`SS_ID_OVERRIDE`) → berlaku seketika **tanpa redeploy**; tombol *"↩ Kembali ke Default"* mengembalikan ke `SS_ID` bawaan di `Code.gs`.
2. **Web App URL** — simpan URL hasil deploy (`https://script.google.com/macros/s/.../exec`) sebagai alamat resmi aplikasi, lengkap dengan tombol 📋 Salin untuk dibagikan ke user.
3. **Status & Checklist** — panel TERHUBUNG/TERPUTUS, indikator sinkron penuh, dan tabel 9 sheet (ada/hilang + jumlah baris). Tombol *"🔄 Tes Koneksi"* sekaligus me-refresh cache master data.
4. Begitu semua sheet wajib terkoneksi & `USER_ROLE` terisi → **user DEMO otomatis nonaktif** (lihat bagian C).

> Catatan: akun yang dipakai deploy ("Execute as: Me") harus punya akses edit ke spreadsheet tujuan.

---

## F. Konfigurasi Rate Lembur

Default: **jam pertama Rp 20.000, jam berikutnya Rp 15.000/jam** (sesuai pola data eksisting: 2 jam = Rp 35.000; 3,5 jam = Rp 57.500).
Ubah kapan saja di menu **Settings → Rate Lembur** (Admin) — tersimpan di Script Properties, tanpa redeploy.

---

## G. Mode Demo (Preview Offline)

File `apps-script/index.html` dapat dibuka langsung di browser **tanpa** Apps Script.
Ia otomatis mendeteksi tidak adanya `google.script.run` dan beralih ke **mode demo** dengan data contoh — berguna untuk presentasi/UAT desain sebelum deploy.

---

## H. Troubleshooting

| Masalah | Solusi |
|---|---|
| "Sheet tidak ditemukan" | Cek nama sheet persis (huruf besar & underscore) |
| Session expired terus | CacheService dibersihkan Google secara berkala; cukup login ulang (TTL 8 jam sliding) |
| Approval tidak muncul utk Manager | Pastikan nama lengkap manager di `USER_ROLE.FullName` sama persis dengan `DATA_KARYAWAN.NamaKaryawan`, dan `IdKaryawan`-nya terdaftar di `APPROVAL_ROLE.IdApproval` |
| Nomor dokumen loncat | Normal — penomoran maju terus agar unik (LockService mencegah duplikat) |
| Lampiran gagal upload | Pastikan akun deploy punya akses Drive; folder `OT_ATTACHMENTS` dibuat otomatis |

---

## I. Keamanan yang Direkomendasikan

1. Spreadsheet **tidak perlu** dishare publik — cukup akun pemilik (web app jalan "Execute as: Me").
2. Setelah go-live, ubah link share sheet menjadi **Restricted**.
3. Ganti password default semua user via menu Settings.
4. Audit Log bersifat append-only — jangan beri akses edit sheet ke user biasa.
