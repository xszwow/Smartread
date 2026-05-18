# SmartRead Release Readiness Current

Generated: 2026-05-18T16:20:56.064Z

## Bottom Line

- Local/dev verification: **PASS**
- Public low-warning distribution: **BLOCKED**
- Full user objective complete: **NO**

The current artifacts are suitable for local and development validation. The full objective is still blocked by public distribution trust requirements: non-development Windows signing, non-development Android signing or managed store signing, and a signed iOS IPA built on macOS/Xcode with Apple provisioning.

## Artifacts

| Item | Status | Path | Size | Modified |
| --- | --- | --- | --- | --- |
| Windows installer | present | `release/SmartRead Setup 0.1.0.exe` | 102.2 MB | 2026-05-18T16:16:36.763Z |
| Windows unpacked exe | present | `release/win-unpacked/SmartRead.exe` | 216.0 MB | 2026-05-18T16:16:00.767Z |
| Windows installed exe | present | `C:\Users\夏\AppData\Local\Programs\SmartRead\SmartRead.exe` | 216.0 MB | 2026-05-18T16:16:24.0000000Z |
| Android debug APK | present | `android/app/build/outputs/apk/debug/app-debug.apk` | 4.1 MB | 2026-05-18T11:47:46.527Z |
| Android release APK | present | `android/app/build/outputs/apk/release/app-release.apk` | 3.1 MB | 2026-05-18T11:47:58.617Z |
| Android release AAB | present | `android/app/build/outputs/bundle/release/app-release.aab` | 3.0 MB | 2026-05-18T15:25:33.431Z |
| iOS signed IPA | missing | `missing release/ios` | missing | - |

## Functional Evidence

- Mobile Metro/e2e: PASS; 6/6 scenarios; artifact `test-artifacts\mobile-empty-shelf-20260518-161222\summary.json`.
- Packaged desktop smoke: PASS; startup page 207ms; window shown 238ms; server healthy 831ms; screenshots `test-artifacts/packaged-desktop-smoke/startup.png`, `test-artifacts/packaged-desktop-smoke/open.png`.
- Installed desktop smoke: PASS; startup page 157ms; window shown 166ms; server healthy 729ms; screenshots `test-artifacts/installed-desktop-smoke/startup.png`, `test-artifacts/installed-desktop-smoke/open.png`.

## Hard Verification Commands

| Command | Status | Evidence excerpt |
| --- | --- | --- |
| Functional coverage audit | PASS | [ok] Mobile e2e target: http://127.0.0.1:4173 / [ok] Mobile e2e records preview server mode: true / [ok] Mobile e2e scenario count: 6 scenarios / [ok] Mobile e2e scenario 01-390x844-guest-empty: ok |
| Native standalone audit | PASS | [ok] Capacitor root config: no external server.url / [ok] Android embedded Capacitor config: no external server.url / [ok] iOS embedded Capacitor config: no external server.url / [ok] mobile-www native config: mobile-www\native-config.js |
| Workspace cleanup audit | PASS | [ok] No stale SmartRead workspace artifacts found. |
| Release artifact audit | PASS | [ok] Windows installer: release/SmartRead Setup 0.1.0.exe (107155912 bytes) / [ok] Windows unpacked exe: release/win-unpacked/SmartRead.exe (226510136 bytes) / [ok] Desktop server entry: release/win-unpacked/resources/app.asar.unpacked/dist/server/index.js (285 bytes) / [ok] Desktop backend dependency fastify: release/win-unpacked/resources/app.asar.unpacked/node_modules/fastify/package.json (2221 bytes) |

## Distribution Gates

| Gate | Status | Evidence excerpt |
| --- | --- | --- |
| Signing environment check | BLOCKED (1) | [ok] Windows signing environment detected / [ok] Android signing environment detected / [missing] iOS: Set IOS_DEVELOPMENT_TEAM or APPLE_TEAM_ID and configure Xcode signing/provisioning. |
| Production signing environment check | BLOCKED (1) | [missing] Windows production signing: set WINDOWS_SIGNING_CERT_THUMBPRINT or WINDOWS_SIGNING_CERT_PATH/CSC_LINK for a non-development Authenticode certificate / [missing] Android production signing: android/keystore.properties -> certs/smartread-android-dev.jks is development-local / [missing] iOS production signing: missing Apple team id; not macOS; Xcode unavailable; signed IPA missing |
| Distribution risk audit | BLOCKED (1) | [risk] Windows public distribution trust: current signer is development/self-signed: status=Valid; subject=CN=SmartRead Local Dev Code Signing; issuer=CN=SmartRead Local Dev Code Signing; thumbprint=CADCB2F70A699096A430B6537590BE486259DD81 / [risk] Android public distribution trust: current keystore is development-local (../certs/smartread-android-dev.jks); use Play App Signing, enterprise signing, or a real release keystore / [risk] iOS public distribution trust: missing signed .ipa and/or Apple Team signing environment; build on macOS with Xcode and Apple Developer provisioning / Distribution risk audit failed. Current artifacts are suitable for local/dev verification, not broad low-warning distribution. |

## Blocking Gaps

- Windows public distribution still needs a non-development signing chain, such as OV/EV code signing or Microsoft Store distribution, to reduce device warnings outside this trusted machine.
- Android release currently uses a development-local signing setup unless replaced by Play App Signing, enterprise signing, or a production release keystore.
- iOS signed `.ipa` is missing in this Windows workspace; create it on macOS with Xcode, Apple Developer Team ID, and provisioning profile using `npm run ios:build:release`.

## Re-run Checklist

```powershell
npm run build
npm test
npm run desktop:pack:win:dev-signed
npm run desktop:smoke:packaged
npm run desktop:smoke:installed
npm run test:e2e:mobile-empty-shelf
npm run functional:audit
npm run native:standalone:audit
npm run release:audit
npm run signing:check
npm run distribution:risk:audit
npm run release:readiness
```

