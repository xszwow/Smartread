# SmartRead Deployment Shapes

Date: 2026-05-18

SmartRead now has four practical deployment shapes. Z-Library egress and proxy settings are optional and must be configured per environment. Do not ship private proxy credentials, node passwords, API keys, or production certificates in the repo or in public app bundles.

## 1. Windows Desktop App

- Electron starts a local SmartRead service on `127.0.0.1` with a random port.
- Desktop mode sets `SMARTREAD_DEPLOYMENT=desktop` and `SMARTREAD_DESKTOP=1`.
- `/api/auth/me` auto-creates `local-desktop@smartread.local`, so the desktop app opens directly into the local shelf without email-code login.
- User data defaults to the Electron AppData directory. Tests can override service data with `SMARTREAD_DATA_DIR` and isolate the Electron profile with `SMARTREAD_USER_DATA_DIR`.
- Z-Library through local Clash/Mihomo is optional. If configured, SmartRead can prefer a Japan group before probing mirrors.

Build and verify:

```powershell
npm run desktop:pack:win:dev-signed
npm run desktop:pack:win:production-signed
npm run desktop:smoke:packaged
npm run desktop:smoke:installed
npm run functional:audit
npm run native:standalone:audit
npm run workspace:clean:audit
npm run release:audit
npm run release:readiness
```

`desktop:pack:win:dev-signed` is the stable local Windows build path on this machine because the full electron-builder signing helper can require symlink privileges while extracting `winCodeSign`. The script builds `release/win-unpacked`, signs `SmartRead.exe`, builds the NSIS installer from that signed payload, and then signs `release/SmartRead Setup 0.1.0.exe`.

`desktop:pack:win:production-signed` uses the same packaging flow but requires a non-development Authenticode certificate. Configure either `WINDOWS_SIGNING_CERT_THUMBPRINT` for a certificate already installed in `CurrentUser\My` or `LocalMachine\My`, or configure `WINDOWS_SIGNING_CERT_PATH`/`CSC_LINK` to a `.pfx` plus `WINDOWS_SIGNING_CERT_PASSWORD`/`CSC_KEY_PASSWORD`. The script refuses self-signed or local-development certificates in production mode and applies `WINDOWS_SIGNING_TIMESTAMP_URL` when set.

The packaged and installed smoke tests save `startup.png` and `open.png` under `test-artifacts/`. `startup.png` proves the app no longer shows a blank cold-start window while the local reading service boots; `open.png` proves TXT import reaches the reader.

Packaging requirements:

- `dist/server/**/*`
- `node_modules/**/*`
- `index.html`
- `index.css`
- `css/**/*`
- `js/**/*`

If any of these are missing from `app.asar.unpacked`, the packaged app can fail to import backend dependencies, show a server 404, or let hidden overlays intercept clicks.

Startup health check:

- Use `/api/health`.
- Do not use `/api/auth/config` as the Electron startup wait target because that endpoint may probe external Z-Library mirrors when explicitly requested.
- Show the built-in startup page immediately, before the local server is ready, so cold desktop startup is not a blank window.
- Treat transient `loadURL` failures as retryable through `did-fail-load`; do not let one `ERR_FAILED` promise rejection quit the app while the server is actually responding.

Installed-app check:

- If Start Menu or an old shortcut flashes and exits, verify it points to the freshly installed `%LOCALAPPDATA%\Programs\SmartRead\SmartRead.exe`.
- The current unpacked build is `release/win-unpacked/SmartRead.exe`; running it directly is the fastest way to distinguish a stale installer from a runtime bug.
- Runtime server logs are written to `%APPDATA%\SmartRead\smartread-server.log`.

## 2. Android App, Default Standalone

Capacitor uses `mobile-www` as the generated web bundle. By default `npm run mobile:prepare` writes:

```js
window.SmartReadNativeConfig = {
  apiBaseUrl: "",
  standalone: true,
  appMode: "mobile"
};
```

Default Android behavior:

- No external SmartRead API server is required.
- Local import reads EPUB / PDF / TXT into device storage.
- Books and progress stay on the device.
- Online book source opens web sources and returns to local import after download.
- AI calls the user-configured OpenAI-compatible endpoint directly from the device.

Build and verify:

```powershell
npm run android:build:debug
npm run android:build:release
npm run android:build:bundle
```

Production Android signing can be supplied without editing tracked files:

```powershell
$env:ANDROID_KEYSTORE_PROPERTIES='C:\secure\smartread-release.properties'
# or:
$env:ANDROID_STORE_FILE='C:\secure\smartread-release.jks'
$env:ANDROID_STORE_PASSWORD='...'
$env:ANDROID_KEY_ALIAS='smartread'
$env:ANDROID_KEY_PASSWORD='...'
npm run android:build:bundle
```

## 3. Native Mobile Connected To A Server

This mode is optional. Use it only when a deployed HTTPS SmartRead API is available.

```powershell
$env:SMARTREAD_NATIVE_STANDALONE='0'
$env:SMARTREAD_NATIVE_API_BASE_URL='https://api.example.com'
npm run mobile:sync
```

Server requirements:

- HTTPS.
- `SMARTREAD_ALLOWED_ORIGINS` includes the native app origin.
- For cross-site cookies: `SMARTREAD_COOKIE_SAMESITE=none` and `SMARTREAD_COOKIE_SECURE=1`.
- Server-side Z-Library egress configured by environment variables only.

## 4. iOS App

- Capacitor iOS project is generated in `ios/`.
- Windows can sync the project, but cannot produce a signed `.ipa`.
- A distributable iOS app requires macOS, Xcode, Apple Developer Program, Bundle ID, signing certificate, and provisioning profile.
- For ordinary devices, use TestFlight/App Store or managed enterprise/MDM distribution.

macOS signed export:

```bash
export IOS_DEVELOPMENT_TEAM=YOUR_TEAM_ID
export IOS_EXPORT_METHOD=development
npm run ios:build:release
```

The script archives `ios/App/App.xcodeproj` with automatic signing and exports into `release/ios/`. Change `IOS_EXPORT_METHOD` to match the distribution channel.

## Signing And Trust

- Windows: local self-signed development certificate validates on the current machine after trust import; this workspace has been verified with `npm run release:audit`. Current thumbprint: `6BDEF7FF00928BD38F25BF2177DD3F1F7B6F8CF9`. On a new target machine, use an elevated shell and run `npm run windows:trust-dev-cert` for local development trust. Public distribution needs OV/EV code signing or Microsoft Store distribution to reduce SmartScreen risk.
- Android: local release keystore signs the APK and passes `apksigner verify`; normal user trust still depends on Play App Signing, enterprise signing, or managed installation policy.
- Android App Bundle output is available through `npm run android:build:bundle`; use it for Play App Signing or managed store-style distribution after replacing the development keystore.
- iOS: unsigned apps cannot be installed on normal devices.

## Verification Commands

```powershell
npm run build
npm test
npm run desktop:smoke
npm run desktop:pack:win:dev-signed
npm run desktop:smoke:packaged
npm run desktop:smoke:installed
npm run test:e2e:mobile-empty-shelf
npm run functional:audit
npm run native:standalone:audit
npm run packaging:check
npm run workspace:clean:audit
npm run signing:check
npm run production-signing:check
npm run distribution:risk:audit
npm run release:audit
npm run release:readiness
```

`npm run signing:check` is expected to report missing iOS signing on Windows unless Apple/Xcode signing variables are configured on macOS.
`npm run production-signing:check` intentionally rejects local development signing and should pass only when non-development Windows, Android, and iOS signing evidence is present.
`npm run distribution:risk:audit` is the public/low-warning distribution gate. It is expected to fail in the current local-dev signing setup until Windows uses an OV/EV certificate or Store distribution, Android uses Play App Signing/enterprise signing, and iOS has a signed IPA from Apple provisioning.
`npm run release:readiness` writes `docs/release-readiness-current.md` with the current artifact list, smoke/e2e evidence, hard verification status, and remaining public distribution blockers.
