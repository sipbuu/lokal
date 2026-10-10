# macOS verification

Release and nightly builds run separately on `macos-15-intel` (x64) and `macos-14` (arm64). Each produces architecture-named DMG and ZIP files. The build hook prepares the matching native audio module; electron-builder rebuilds its native dependencies. Release aggregation retains both architectures in the macOS updater manifest.

## Optional release credentials

Only the release/nightly macOS build steps receive these GitHub Actions secrets:

| Name | Purpose |
| --- | --- |
| `CSC_LINK` | electron-builder signing certificate input containing a Developer ID Application identity |
| `CSC_KEY_PASSWORD` | Password for that signing certificate |
| `APPLE_ID` | Apple ID used by electron-builder's notarytool integration |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple Developer team ID |

Developer ID signing requires the first two inputs. Optional notarization uses all three `APPLE_*` inputs together and requires an eligible signed build. The installed electron-builder 26.15.3 supports these environment variables and automatically attempts notarization when supplied. Partial notarization credentials can fail the build. No credential values belong in the repository or documentation.

Without signing credentials, release/nightly and the credential-free PR workflow use ad-hoc signing and explicitly disable notarization. Ad-hoc signing verifies a bundle's local integrity; it is not Developer ID signing, notarization, or Gatekeeper approval.

The PR packaging step enables `CSC_FOR_PULL_REQUEST` only with the explicit ad-hoc identity `-` and no signing secrets. Otherwise electron-builder skips signing in PR builds, leaving the upstream Electron signature invalid after the bundle is changed. Never pass Developer ID credentials into this PR step.

## Automated checks

The macOS PR workflow installs Electron once before starting concurrent test workers, then runs explicitly selected download/video, discovery UI, YouTube account/session/login, and native playback adapter suites with bounded timeouts. Fixtures mock provider responses and audio adapters; they do not perform interactive Google sign-in or prove audible output.

After packaging, `npm run verify:mac-package -- release x64` or `npm run verify:mac-package -- release arm64` checks:

- ZIP structure and DMG checksums.
- The executable and unpacked native audio module's Mach-O architecture.
- Bundle plist validity and existing signatures with `codesign --verify --deep --strict`.
- A Developer ID Application signature when signing credentials were configured.
- Packaged Electron loading SQLite, native audio and sharp on the matching architecture.

The verifier does not assess notarization or Gatekeeper acceptance. Both architectures' checks must complete on their real macOS runners; a Windows build does not establish their results.

## Interactive verification still required

On Intel and Apple Silicon Macs, download the exact release DMG/ZIP through a browser so quarantine metadata is present. Install and launch normally through Finder without removing quarantine or bypassing Gatekeeper. Record the artifact checksum, macOS version, signature identity, notarization/stapling receipt and the first-launch result. Where notarization was configured, independently verify the ticket with `xcrun stapler validate` and assess the installed app with `spctl --assess --type execute --verbose`.

Test real speakers/headphones with local and streamed audio, Auto/native output, 16-bit/float output, seek/pause/resume, EQ, crossfade, device changes and minimized playback. Verify durable videos and hover previews offline, and confirm migration/refresh/restart keeps saved-video associations. Complete embedded/browser YouTube login interactively without exposing authentication material.

No successful notarization submission, stapled ticket, quarantined first launch, Gatekeeper acceptance or audible playback is established by these code changes alone.
