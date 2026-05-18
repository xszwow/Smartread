# SmartRead Verification Report

Date: 2026-05-18

## Scope

- Windows desktop app packaging and runtime
- Android standalone app build and signing
- iOS Capacitor project generation boundary
- Mobile Metro home UI
- Local import and reader opening
- Z-Library mirror/proxy/search flows
- AI configuration and chat flows
- Documentation and maintenance instructions

## Feature Inventory

### Desktop

- Electron shell launches local Fastify service.
- Random loopback port on `127.0.0.1`.
- Desktop mode auto-creates a local account through `/api/auth/me`.
- Local EPUB / PDF / TXT import.
- Reader opens imported TXT in packaged app smoke test.
- Local server logs are written to the Electron userData directory.

### Android Standalone

- Capacitor web bundle copied to `mobile-www`.
- `native-config.js` defaults to `standalone: true`.
- No external SmartRead server is required.
- Local books and progress stay on the device.
- Online source page opens web sources instead of server-side Z-Library download.
- AI can call the user-configured OpenAI-compatible endpoint directly.

### Web / Server

- Email-code login for web/server mode.
- Optional Z-Library bind, unbind, rebind.
- Z-Library mirror probing and fallback.
- Optional direct/proxy egress and optional Clash/Mihomo selector switch.
- Server-side book download and progress APIs.
- AI config encryption and chat proxy.

### Mobile Home UI

- Authenticated mobile home is a non-uniform Metro tile dashboard.
- Primary tile changes by state:
  - no books: import is primary
  - books without reading record: library is primary
  - recent reading record: continue reading is primary
- Import, library, online, AI, and account are separate feature pages.
- Feature pages use “返回上一级”.

## Bugs Found And Fixed

| ID | Bug | Impact | Fix | Verification |
| --- | --- | --- | --- | --- |
| B1 | Mobile empty shelf was a long explanatory page | First screen felt like a scroll document | Rebuilt mobile home as state-driven Metro tiles | Mobile screenshot e2e scenarios 02-05 |
| B2 | Z-Library mirror/default URL could timeout | Binding/search unreliable | Added mirror list, probing, failover, register URL selection | Backend mirror tests |
| B3 | Search pagination could lose later-page results | Desktop/mobile search looked limited | Added pagination state and fallback parser path | Backend pagination tests |
| B4 | Mobile search results stacked image above text | Poor mobile scanability | Changed results to one-row cover/text/action layout | Mobile screenshot e2e |
| B5 | Mobile page said “返回主页” | Navigation felt wrong | Changed copy to “返回上一级” | Mobile page navigation e2e |
| B6 | Z-Library could not be changed after binding | No rebind path | Added rebind/cancel/unbind flows | Mobile and backend checks |
| B7 | Register Z-Library link could use an unavailable mirror | Registration appeared broken | Register URL now comes from a web-capable mirror | Backend resolver test |
| B8 | Native mobile connected mode lacked CORS/cookie controls | Native login/session would fail in connected mode | Added allowed origins and SameSite/Secure config | Backend native-origin test |
| B9 | Electron server entry inside asar was brittle | Packaged app could fail to start server | Unpacked server entry and resolved it explicitly | Packaged desktop smoke |
| B10 | Native password hash dependency complicated packaging | Windows package needed extra build tools | Replaced unused native dependency with `crypto.scrypt` | Backend password test |
| B11 | Mobile prepare wrote bundle in-place | Half-written `mobile-www` possible | Stage then atomic rename | Mobile sync and Android builds |
| B12 | Old Windows package lacked unpacked frontend files | Packaged app showed 404 / failed UI | Unpacked `index.html`, `index.css`, `css`, `js` | Resource check and packaged smoke |
| B13 | Missing `index.css` in package left `.hidden` undefined | Hidden overlay intercepted book-card clicks | Added `index.css` to package files and `asarUnpack` | Packaged TXT import/open smoke |
| B14 | Desktop app required email-code login | Single-machine app depended on external mail | Desktop `/api/auth/me` auto-creates local user | Backend test and packaged smoke |
| B15 | README had obsolete server/IP deployment notes | Unsafe and misleading maintenance doc | Rewrote README for current deployment shapes | Documentation review |
| B16 | Installed Windows app could not import `fastify` from unpacked server code | Local reading service exited with code 1 after install | Added `node_modules/**/*` to `asarUnpack` and verified dependency presence | Isolated packaged smoke |
| B17 | Electron startup waited on `/api/auth/config`, which could probe external Z-Library mirrors | Window could timeout or flash/close when offline or mirrors were slow | Added `/api/health` and changed desktop startup wait target | AppData log and isolated packaged smoke |
| B18 | Windows development certificate was signed but not trusted in the normal user certificate stores | `release:audit` reported `UnknownError`; devices could still warn | Added `windows:trust-dev-cert` admin script, imported the cert with administrator privileges, and made `release:audit` fail until trust is present | `npm run release:audit` now reports `Valid` for installer and unpacked exe |
| B19 | npm scripts resolved `node` through a restricted WindowsApps/Codex path | `npm run build`, `npm test`, and `npm run release:audit` could fail with `Access is denied` even when direct local Node worked | Updated npm scripts to call the bundled `tools/node-v24.15.0-win-x64/node.exe` explicitly | `npm run build`, `npm test`, `npm run packaging:check`, and `npm run release:audit` pass |
| B20 | Packaged desktop smoke could reuse the real Electron userData/IndexedDB profile | A stale installed profile could make automation wait on the wrong authenticated state or hide runtime regressions | Added `SMARTREAD_USER_DATA_DIR` support in `desktop/main.cjs` and set it in packaged smoke | `npm run desktop:smoke:packaged` passes with isolated temp data and userData directories |
| B21 | Release audit only checked files and signatures, not the critical desktop startup code inside `app.asar` | A package could pass audit while missing userData isolation or still waiting on a slow external config probe | Added `app.asar` content checks for `SMARTREAD_USER_DATA_DIR` and `/api/health` | `npm run release:audit` now reports both checks as `ok` |
| B22 | The NSIS installer was signed after packaging, but its embedded `SmartRead.exe` payload stayed unsigned | Installed Start Menu version reported `NotSigned` even though the installer itself was `Valid` | Added `desktop:pack:win:dev-signed`: build unpacked app, sign unpacked exe, build installer from signed payload, sign installer | Installed `%LOCALAPPDATA%\Programs\SmartRead\SmartRead.exe` now reports `Valid` with thumbprint `6BDEF7FF00928BD38F25BF2177DD3F1F7B6F8CF9` |
| B23 | Desktop startup could show a long blank window during local server cold start | User saw blank before the home page appeared | Added an immediate built-in startup page before launching the local server, keep the Electron window hidden until that page renders, and log desktop startup timing | `startup.png` from packaged and installed smoke shows the built-in startup page; installed smoke logs show the startup page rendered and the window shown in under 300ms |
| B24 | Electron `loadURL` could reject with transient `ERR_FAILED` while the local server was responding | User saw `SmartRead 启动失败 ERR_FAILED (-2)` even though `/` and static assets returned 200 | Changed desktop loading to event-based `did-fail-load` retry and removed fatal handling of one promise rejection | Installed app logs show `/api/health`, frontend assets, `/api/auth/me`, `/api/books`; packaged smoke passes |
| B25 | Packaged smoke waited on an unstable load event and deleted failure logs | A working page could still time out, and failures were hard to diagnose | Wait directly for business DOM, preserve server logs/screenshots on failure, and avoid copying the full package before launch | `npm run desktop:smoke:packaged` passes |
| B26 | There was no automated test for the real installed Windows path | A release directory could pass while `%LOCALAPPDATA%\Programs\SmartRead\SmartRead.exe` was stale, unsigned, or broken | Added `desktop:smoke:installed` to test the installed executable directly | `npm run desktop:smoke:installed` passes |
| B27 | iOS signed export path was only described manually | Moving to a macOS signer still required reconstructing xcodebuild commands | Added `scripts/build-ios-release.sh` and `npm run ios:build:release` for macOS/Xcode archive and export | Script is present and documented; execution remains blocked on Windows |
| B28 | There was no single current-state readiness report separating verified local delivery from public distribution blockers | A green release audit could be mistaken for full completion even though iOS IPA and production trust were still missing | Added `npm run release:readiness` to generate `docs/release-readiness-current.md` with artifacts, smoke/e2e evidence, hard checks, advisory gates, and blocking gaps | `npm run release:readiness` reports local/dev validation `PASS` and public low-warning distribution `BLOCKED` |
| B29 | Android had no one-command AAB build path for Play-style distribution, and production signing readiness was only implicit in the risk audit | It was too easy to stop at a dev-signed APK even when the target asks for device-trusted app delivery | Added `npm run android:build:bundle` and `npm run production-signing:check`; readiness report now lists Android AAB and production signing status | AAB build path is scripted; production signing check correctly blocks the current dev-signing environment |
| B30 | Windows and Android formal signing still required editing local scripts or tracked files | Real certificates could not be plugged in cleanly without risking secret leakage or accidentally falling back to dev signing | Added `desktop:pack:win:production-signed`, production-mode Windows signing, Android environment/properties based production keystore support, and an ignored/example keystore properties file | Syntax checks pass; production signing check still blocks because real production certs are not present |

## Verification Runs

### Passed

- `npm run build`
- `npm test`: 19 tests passed
- `npm run desktop:smoke`
- `npm run desktop:smoke:packaged`
- `npm run desktop:smoke:installed`
- `npm run test:e2e:mobile-empty-shelf`: 6 scenarios passed
- `npm run functional:audit`: latest functional evidence audit passed
- `npm run native:standalone:audit`: Android/iOS embedded public resources match `mobile-www`, and no Capacitor `server.url` is configured
- `npm run workspace:clean:audit`: stale failure screenshots, old mobile e2e runs beyond the retained latest 5, and stale SmartRead temp dirs are cleaned
- `npm run packaging:check`
- `npm run desktop:pack:win:dev-signed`
- `npm run ios:build:release`: scaffolded for macOS/Xcode, not executable on this Windows host
- Windows Authenticode verification: `Valid`
- Installed Windows app Authenticode verification: `Valid`
- Windows packaged smoke with isolated temp data/userData: passed
- Windows installed-app smoke from `%LOCALAPPDATA%\Programs\SmartRead\SmartRead.exe`: passed
- Startup non-blank screenshots: `test-artifacts/packaged-desktop-smoke/startup.png` and `test-artifacts/installed-desktop-smoke/startup.png`
- Desktop startup timing logs are written to `smartread-server.log` with `desktop +Nms` markers.
- Mobile empty-shelf e2e now compiles first and auto-starts/stops the local preview server when `127.0.0.1:4173` is unavailable.
- Android debug APK build
- Android release APK build
- Android release APK `apksigner verify --verbose --print-certs`: verified with v2 scheme
- Capacitor Android/iOS sync
- `npm run release:audit`: passes Windows artifact/signature trust, desktop packaging contents, desktop `app.asar` startup-code checks for userData isolation, startup page, `/api/health`, and load retry, Android artifacts/signature, and mobile/iOS project artifact checks
- `npm run release:readiness`: generated `docs/release-readiness-current.md`; current status is local/dev validation passed, public low-warning distribution blocked
- `C:\Program Files\Git\bin\bash.exe -n scripts/build-ios-release.sh`: iOS macOS release script syntax check passed on Windows Git Bash
- `npm run signing:check`: reports Windows and Android signing environments available, and intentionally reports iOS signing missing on this Windows host until Apple/Xcode signing is configured.
- `npm run production-signing:check`: intentionally fails until Windows uses a non-development Authenticode certificate, Android uses a non-development keystore/managed signing path, and iOS has a signed IPA from Apple provisioning.
- `npm run distribution:risk:audit`: intentionally fails in the current local-dev signing setup; it reports Windows self-signed dev certificate, Android dev keystore, and missing iOS signed IPA as public distribution risks.

### Mobile Screenshot E2E Scenarios

- Guest empty shelf
- Authenticated empty shelf, Z-Library unbound
- Authenticated empty shelf, Z-Library bound
- Authenticated shelf with books but no read record
- Authenticated shelf with recent read record
- Desktop empty shelf regression at 1280x844

Latest screenshot artifacts:

- `test-artifacts/mobile-empty-shelf-20260518-131229`
- `test-artifacts/packaged-desktop-smoke/open.png`
- `test-artifacts/installed-desktop-smoke/open.png`

## Current Artifacts

- Windows installer: `release/SmartRead Setup 0.1.0.exe`
- Windows unpacked app: `release/win-unpacked/SmartRead.exe`
- Android debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Android release APK: `android/app/build/outputs/apk/release/app-release.apk`
- iOS project: `ios/`
- Windows local development cert export: `certs/SmartReadLocalDevCodeSigning.cer`
- Android local development keystore: `certs/smartread-android-dev.jks`

## Signing Status

### Windows

- `release/win-unpacked/SmartRead.exe`: signed by `CN=SmartRead Local Dev Code Signing`
- `release/SmartRead Setup 0.1.0.exe`: signed by `CN=SmartRead Local Dev Code Signing`
- Certificate: `CN=SmartRead Local Dev Code Signing`
- Thumbprint: `6BDEF7FF00928BD38F25BF2177DD3F1F7B6F8CF9`
- Current machine trust: `release:audit` reports `Valid` with the certificate present in CurrentUser and LocalMachine Root/TrustedPublisher stores.
- Boundary: this is a local development certificate. It must be trusted on each target machine with `npm run windows:trust-dev-cert` from an elevated shell. Public user devices still need OV/EV code signing or Store distribution for better trust.

### Android

- Release APK signed with local development keystore.
- `apksigner verify` passed with v2 signature.
- Signer DN: `CN=SmartRead Local Dev, O=SmartRead, C=CN`
- Boundary: for broad distribution, use Play App Signing or enterprise/MDM distribution.

### iOS

- Capacitor iOS project exists and syncs.
- Signed `.ipa` was not produced on Windows.
- Required to finish iOS distribution: macOS, Xcode, Apple Developer Team, signing certificate, provisioning profile, and TestFlight/App Store or managed distribution.
- A macOS build script is now available at `scripts/build-ios-release.sh`; it exports signed builds into `release/ios/` when Apple signing is configured.

## Remaining Risks

- Production Windows trust is not complete without a real code-signing certificate or Store distribution.
- Production Android trust is not complete without a real distribution channel.
- iOS installable build is blocked by missing macOS/Xcode/Apple signing environment.
- Mobile standalone online book flow relies on external websites opened by the user, not server-side Z-Library automation.

## Status

Windows desktop and Android standalone builds are implemented and verified, including Windows local certificate trust on this machine. iOS project generation is complete, but signed iOS app packaging remains blocked by the required Apple/macOS signing environment.
