# Ectode

**Ectode** is a mobile and web utility for scanning QR codes and barcodes (from the camera, screen, or image files), reconstructing them in crisp clean quality, generating custom codes, and organizing them into folders.

---

## Features

### Scanning & Recognition
- **Real-time camera scanning** — native Android CameraX scanning with flashlight/torch control or browser camera support.
- **Screen capture scanning** — recognize codes directly from your device screen (via `MediaProjection` on Android or `getDisplayMedia` in the browser).
- **File import** — load images from your gallery or device storage.
- **Supported formats**:
  - 2D: **QR Code**
  - 1D: **Code 128**, **EAN-13**, **EAN-8**, **UPC-A**, **UPC-E**, **Code 39**, **ITF-14**, **Codabar**
- **Smart content parsing** — automatic detection of URLs, Wi-Fi networks, contacts (vCard), phone numbers, e-mails, tickets, loyalty cards, and plain text.

### Clean Reconstruction & Generation
- **High-clarity output** — restores even wrinkled or blurry scanned codes into clean vector/raster graphics.
- **Code generator** — create QR codes (text, URL, Wi-Fi with encryption selection, vCard contacts) and standard 1D barcodes.
- **Appearance customization** — customize foreground and background colors via an RGB palette, error correction level (`L`, `M`, `Q`, `H`), and quiet-zone margins.
- **Flexible export** — save and share in **PNG**, **SVG**, and **JPEG** formats (tap to download in your default format, or long-press to choose `PNG / SVG / JPEG`).

### Organization & Quick Access
- **Folder library** — organize saved codes into default and custom folders with configurable icons, colors, and drag-and-drop folder reordering.
- **Search, sorting & favorites** — quick access to passes, tickets, and loyalty cards.
- **Turnstile / Pass presentation mode** — fullscreen code display with automatic screen brightness boost for reliable optical scanner reading.
- **Open links in supported apps (Android)** — open scanned links either in your browser or directly in a supported installed application.
- **Quick Settings Tiles** — pin quick-launch tiles for camera scanning or screen capture directly to the Android Quick Settings panel.

### Personalization
- **Dark (AMOLED) & Light themes** with adaptive system bars.
- **Bilingual UI**: Russian and English (`RU` / `EN`).
- **Sound & haptic feedback**: independent sound and vibration toggles that persist across restarts.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Motion, Lucide Icons
- **QR & Barcode Engine:** `qrcode`, `jsqr`, `jsbarcode`, `@zxing/library`, Google ZXing (`com.google.zxing:core`)
- **Mobile Runtime:** Capacitor 8 (Android), CameraX 1.4.2
- **Native Android Plugins:**
  - `NativeCameraPlugin` — CameraX preview, decoding, and torch toggle
  - `ScreenCapturePlugin` / `ScreenCaptureService` — screen capture via `MediaProjection`
  - `QuickActionPlugin` / `QuickCameraTileService` / `QuickScreenTileService` — Android Quick Settings tiles and shortcuts
  - `NativeLinkPlugin` — opening links in supported installed apps or browsers
  - `ScreenBrightnessPlugin` — automatic brightness boost during code presentation
  - `NativeDownloadPlugin`, `NativeSharePlugin`, `NativeClipboardPlugin` — file saving, sharing, and clipboard integration

---

## Getting Started

### Prerequisites
- **Node.js** `22+`
- **npm**
- For Android builds: **JDK 21** and **Android SDK** (`minSdk 24` / `targetSdk 36`)

### Install & Run Web App

```bash
npm install
npm run dev
```

The development server will be available at `http://localhost:3000`.

### Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start the Vite dev server (port `3000`) |
| `npm run build` | Build the production web bundle into `dist/` |
| `npm run preview` | Preview the built `dist/` bundle locally |
| `npm run lint` | Run TypeScript type checking (`tsc --noEmit`) |
| `npm test` | Run unit tests (`src/utils/qrLogic.test.ts`) |
| `npm run android:prepare` | Build web assets, configure `AndroidManifest.xml`, and sync Capacitor |
| `npm run android:apk` | Build a Debug APK |
| `npm run android:apk:release` | Build a Release APK |
| `npm run android:aab` | Build a Release Android App Bundle (`.aab`) |
| `npm run android:open` | Open the Android project in Android Studio |

---

## Android Build & CI/CD (GitHub Actions)

The repository includes [`.github/workflows/android-apk.yml`](./.github/workflows/android-apk.yml), which runs on pushes to `main` / `master` or manual `workflow_dispatch`:

1. Runs `npm run lint` and `npm test`.
2. Builds web assets and prepares the Capacitor Android project (`npm run android:prepare`).
3. Builds signed **Release APK** and **AAB** files when signing secrets are configured, or falls back to a **Debug APK** otherwise.
4. Automatically creates a GitHub Release tagged with the version from `package.json` and attaches the build artifacts.

To enable release signing, configure the following repository secrets in GitHub (`Settings → Secrets and variables → Actions`):
- `ANDROID_KEYSTORE_BASE64` — Base64-encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_KEY_ALIAS` — signing key alias
- `ANDROID_KEY_PASSWORD` — signing key password

---

## Project Structure

```text
├── .github/workflows/       # CI/CD pipeline for APK / AAB builds and GitHub Releases
├── android/                 # Native Capacitor Android project and custom Java plugins
├── public/                  # Public static assets (app icon, etc.)
├── scripts/                 # Scripts for Android platform & manifest setup
├── src/
│   ├── components/          # UI components (scanner, gallery, generator, settings, modals)
│   ├── utils/               # Parsing/generation logic, rendering, storage, bridges, tests
│   ├── App.tsx              # Root component and navigation
│   └── main.tsx             # React entry point
├── capacitor.config.ts      # Capacitor configuration (appId: com.raspingmango.ectode)
└── package.json             # Dependencies and build scripts
```

---

## License

This project is licensed under the [MIT License](./LICENSE).
