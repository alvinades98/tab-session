# MultiSession Pro v1.2.0 — Per-Tab Multi-Session Engine

Chrome Extension Multi-Account & Per-Tab Isolation

Ekstensi Chrome (Manifest V3) untuk mengelola multiple session dan multi-akun secara **Per-Tab** maupun **Per-Domain** tanpa perlu logout atau membuka mode incognito.

---

## 🚀 Fitur Utama
- **⚡ Drag-and-Drop ke Tab Group:** Cukup seret (drag) tab apa pun ke dalam Chrome Tab Group session tertentu (misal Group *Work* atau *Alt Account*), tab tersebut akan otomatis berganti ke session group tersebut!
- **⚡ Isolasi Sesi Per-Tab (True Multi-Session):** Buka website yang sama di banyak tab berdampingan dengan akun berbeda (misal Tab 1 = Akun Kantor, Tab 2 = Akun Pribadi).
- **🎛️ 1-Click Card Switch:** Klik langsung di card session mana pun pada popup untuk langsung berganti session.
- **🎨 Indikator Tab Visual Lengkap:**
  - Favicon tab berhias titik warna profil.
  - Prefix judul tab: `[💼 Work] Judul Halaman`.
  - Header Chrome Tab Group berwarna sesuai session.
  - Floating watermark mini di pojok kanan bawah halaman web.
- **🖱️ Klik Kanan Context Menu:** Buka link atau duplikasi halaman langsung di tab session baru.
- **📦 Backup & Restore:** Simpan dan pulihkan database session dan cookie ke file JSON.

---

## 📦 Cara Memasang di Chrome

1. Buka `chrome://extensions` di Google Chrome.
2. Aktifkan **Developer mode** di pojok kanan atas.
3. Klik tombol **Load unpacked** (atau tombol *Muat yang belum dibongkar*).
4. Pilih folder:
   ```
   /home/marco/Documents/extension
   ```
5. Pin ikon **MultiSession Pro** di toolbar browser.

---

## 💡 Cara Menggunakan Fitur Drag Tab ke Group

1. Buat atau buka tab dengan session profil tertentu (misal: *Work / Kantor*).
2. Tab tersebut akan otomatis memiliki Tab Group Chrome bertuliskan `💼 Work / Kantor` dengan warna birunya.
3. Seret (drag) tab website lain ke dalam Tab Group tersebut.
4. Tab yang baru dimasukkan akan **otomatis berganti ke profil session Work**, memuat cookie akun Work, dan memperbarui penanda tabnya secara instan!
