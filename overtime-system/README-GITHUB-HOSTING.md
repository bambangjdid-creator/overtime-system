# 🌐 HOSTING DI GITHUB PAGES — OVERTIME SYSTEM

Arsitektur hosting eksternal:

```
┌──────────────────────────┐         fetch POST (JSON)        ┌─────────────────────────┐
│  GITHUB PAGES (frontend) │ ───────────────────────────────▶ │  APPS SCRIPT (backend)  │
│  https://user.github.io  │ ◀─────────────────────────────── │  doPost → apiXxx(...)   │
│  docs/index.html (SPA)   │            JSON response         │  + Google Sheet + Drive │
└──────────────────────────┘                                  └─────────────────────────┘
```

> Frontend statis di GitHub; data tetap aman di Google (Sheet + Drive).
> Backend **wajib tetap di Apps Script** karena hanya ia yang bisa akses GSheet/Drive Anda.

---

## LANGKAH 1 — Deploy Backend (Apps Script)

1. Buka spreadsheet → **Extensions → Apps Script**.
2. Pastikan `Code.gs` adalah **versi terbaru** (sudah berisi fungsi `doPost` untuk REST API).
3. **Deploy → New deployment** (atau Manage deployments → New version):
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** ← *wajib "Anyone" agar bisa diakses dari GitHub Pages*
4. Salin **Web App URL**: `https://script.google.com/macros/s/XXXXX/exec`

## LANGKAH 2 — Buat Repo GitHub & Upload Frontend

1. Buat repository baru di GitHub, mis. `overtime-system` (Public).
2. Upload folder **`docs/`** dari workspace ini (berisi `index.html`).
   ```bash
   git init
   git add docs/
   git commit -m "Overtime System frontend"
   git branch -M main
   git remote add origin https://github.com/USERNAME/overtime-system.git
   git push -u origin main
   ```
3. (Opsional, agar URL backend tertanam permanen) Edit `docs/index.html`, cari baris:
   ```js
   const GAS_API_URL_DEFAULT = '';
   ```
   isi dengan Web App URL Anda:
   ```js
   const GAS_API_URL_DEFAULT = 'https://script.google.com/macros/s/XXXXX/exec';
   ```

## LANGKAH 3 — Aktifkan GitHub Pages

1. Repo → **Settings → Pages**.
2. Source: **Deploy from a branch** → Branch: `main` → Folder: **`/docs`** → Save.
3. Tunggu ±1 menit → aplikasi live di:
   `https://USERNAME.github.io/overtime-system/`

## LANGKAH 4 — Hubungkan Frontend ke Backend

Jika Anda **tidak** mengisi `GAS_API_URL_DEFAULT` di Langkah 2:

1. Buka URL GitHub Pages Anda.
2. Di halaman login, klik **"⚙ Atur koneksi backend"** (link kecil di bawah).
3. Tempel Web App URL → **💾 Simpan & Hubungkan** → halaman reload.
4. Indikator kanan atas berubah menjadi **"Terhubung API (Hosting Eksternal)"** → login dengan akun GSheet Anda.

> URL tersimpan di localStorage browser masing-masing pengguna. Untuk deploy ke banyak user, lebih praktis isi `GAS_API_URL_DEFAULT` (Langkah 2.3).

---

## CARA KERJA TEKNIS

- Frontend mendeteksi mode otomatis:
  | Kondisi | Mode |
  |---|---|
  | Dibuka dari URL `script.google.com/.../exec` | **GAS** (google.script.run) |
  | Dibuka dari GitHub Pages + API URL terisi | **REMOTE** (fetch REST) |
  | Tanpa keduanya | **DEMO** (data contoh) |
- Mode REMOTE memanggil `doPost` Apps Script dengan body JSON `{fn:"apiLogin", args:[...]}`.
  Content-Type `text/plain` digunakan agar **bebas CORS preflight** (Apps Script tidak mendukung OPTIONS).
- Keamanan: `doPost` hanya mengizinkan fungsi berawalan `api*`, dan setiap fungsi tetap memvalidasi **session token** + RBAC di server. Password tidak pernah disimpan di frontend.

## UPDATE VERSI

| Bagian | Cara update |
|---|---|
| Frontend | Edit `docs/index.html` → commit → push (Pages auto-rebuild ±1 mnt) |
| Backend | Edit Code.gs → Deploy → Manage deployments → ✏️ → **New version** (URL tetap) |

## TROUBLESHOOTING

| Masalah | Solusi |
|---|---|
| "HTTP 403 / 401" saat login | Deployment Apps Script belum "Anyone" — redeploy dgn akses Anyone |
| "Failed to fetch" | URL salah / belum `https://.../exec` / ekstensi browser memblokir |
| Login berhasil tapi data kosong | Web App URL menunjuk deployment lama — buat **New version** |
| Berubah jadi Mode Demo sendiri | localStorage terhapus — isi ulang via "⚙ Atur koneksi backend" atau pakai `GAS_API_URL_DEFAULT` |
| Sesi cepat habis | Normal: token 8 jam sliding; login ulang |
