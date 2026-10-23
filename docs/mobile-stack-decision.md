# Split Money mobile app — stack decision record

2026-10-12 · agreed by Architect A (opened for React Native + Expo) and Architect B (opened for Flutter) after three rounds; both signed off.
Source of requirements: [split-money-srs.md](split-money-srs.md). Section, FR, BR, GAP and AT references below point into it.

## Decision

Build the mobile client for iOS and Android with **React Native on Expo, in TypeScript**. Flutter is the runner-up and is not chosen. Kotlin Multiplatform and wrapping the web app (Capacitor or a PWA) were rejected by both architects.

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Expo, development builds | On scaffold day run `npm view expo dist-tags` and use `latest`, never `next`. On 2026-10-12 `latest` is SDK 57 (React Native 0.86) and SDK 58 is still beta. If the project starts on 57, upgrade once `latest` is 58 and before build step 4. |
| Language | TypeScript, strict, `noUncheckedIndexedAccess` | |
| Navigation and links | Expo Router, associated domains (iOS), verified app links (Android) | |
| Server state | TanStack Query v5 | Socket events invalidate queries. |
| Client state | Zustand | Only state needed outside React: session, theme, pending deletes. No server data. |
| HTTP | A thin fetch wrapper | Any 401 clears secure storage and the query cache, then shows sign-in. |
| Secure storage | expo-secure-store | Token never in plain preferences (NFR-10). |
| Google sign-in | expo-web-browser `openAuthSessionAsync` plus an `auth/callback` route | The route accepts a result only while a sign-in is pending. The redirect should be a verified https app link, named exactly in the backend allow-list. |
| Apple sign-in | expo-apple-authentication (iOS) | Needs a new backend endpoint (GAP-09). |
| Real-time | socket.io-client 4.x | The same official client the web app runs. |
| File export | expo-file-system `File.createDownloadTask(url, dest, {headers})`, then expo-sharing | Documented path in the SDK 57 and 58 references; confirm on a device before build step 8. |
| Charts | Hand-drawn with react-native-svg | Three static charts. Time-box to one day; fall back to react-native-gifted-charts. |
| Forms and money input | Reducer-held form state; reuse `stepValidation.ts` and `currency.ts` | Pin the caret to the end of masked inputs. |
| Shared logic | Copied from the web client into `src/shared` | 482 lines of logic and 298 of types import unchanged. Guarded by golden-vector tests from SRS section 11, run once on Hermes on a device as well as in Jest. Not a workspace package: web and backend are separate git submodules with no root package. |
| Unit and component tests | Jest (jest-expo), React Native Testing Library | |
| End-to-end tests | Maestro on both simulators | Against the local docker-compose backend, user seeded with `POST /auth/register`, session injected by an E2E-only build. |
| Build, submit, over-the-air | EAS Build, EAS Submit, EAS Update | Free tier covers launch: 15 iOS and 15 Android builds a month, updates to 1,000 monthly users. |
| CI | GitHub Actions for lint and tests | None exists today. |

## Why this stack

1. **One language across backend, web and mobile.** A solo developer reviewing agent-written money code reviews best in the language he writes daily (section 11, 14.8).
2. **Number semantics identical to the server.** No sort-stability, rounding or int/double hazards to test for when porting BR-1, BR-3 and BR-13.
3. **The official Socket.IO client** the web app already runs (section 10).
4. **First-party build, submission and over-the-air updates** on a free tier.
5. **Some real reuse.** Useful, not decisive (7.7, 11.11).

Architect B's summary of why Flutter lost: its advantages fail visibly and cosmetically, while its failure modes on this project are silent and numerical.

## What we give up by not choosing Flutter

| Given up | Mitigation |
| --- | --- |
| Direct caret control for money masking (BR-25) | Reuse `formatCurrencyInput`, pin the caret to the end, and run an Android end-to-end flow that edits mid-string. |
| Widget tests against real layout | Maestro flows on both simulators for every acceptance scenario that has UI. |
| One renderer on both platforms | SVG charts, token-based components with no platform branches, screenshots on both platforms. |
| Slower API churn | Pinned versions, one SDK upgrade between releases, versioned docs given to coding agents. |

## Risks, ranked, and when to retire each

Step numbers are the build order in SRS section 17.1.

1. Android sign-in return race, secure storage and 401 handling: device spike in step 1.
2. Store blockers (Apple sign-in, account deletion): decided in step 1; a skeleton build goes through TestFlight and Play internal testing by the end of step 2.
3. Client logic drifting from the server: golden vectors pass before step 4.
4. History paging against event-driven invalidation (FR-HIS-11, AT-22): tested in step 3.
5. Socket handshake, room re-join and foreground refetch: spike at the start of step 3, not left to step 7.
6. Undo-delete when the app is backgrounded (FR-EXP-15): step 4.
7. Export download and share sheet: spike before step 8.

## Rules agreed during the debate

- **Undo-delete on mobile.** When the app leaves the foreground, send every pending delete immediately; undo ends there. Treat a 404 as success. On failure, restore the row and show the error on return. Signing out cancels pending deletes.
- **E2E session injection** is acceptable only if all four hold: it is compiled in solely by a dedicated `e2e` build profile with its own bundle ID and update channel; it reads a launch argument, not a deep link; it refuses any non-local backend URL; CI fails if the injection symbol appears in the production bundle.

## Backend prerequisites

| Order | Change | Blocks |
| --- | --- | --- |
| 1 | GAP-01 allow-list `mobile_redirect`, together with GAP-02 one-time code instead of a token in the URL | Distributing any build from step 1 |
| 2 | GAP-03 deployed (fixed on branch `fix/validate-expense-members`, commit `acf77cb`, not yet merged) | Step 4 |
| 3 | Association files (`apple-app-site-association`, `assetlinks.json`) on the web host, exempt from the catch-all rewrite | Step 6 invite links, and the https sign-in redirect |
| 4 | GAP-09 endpoint that verifies a native Apple identity token | App Store submission |
| 5 | Account deletion (NFR-36; App Store guideline 5.1.1(v)) | Store submission |
| 6 | GAP-07 rate limiting | Public launch |
| 7 | Optional: GAP-25 single-expense read, GAP-17 409 on lock conflict | Ease step 4 |

## Decisions still open for the product owner

- Apple sign-in on iOS only, and what Apple-account users do on Android.
- Push notifications and offline entry: in or out of the first release.
- Invite links that open the app, or the bare code only.
- An expense date field (GAP-11).
- Keep or disable the password endpoints in production.
- Token lifetime: 7 days with no refresh (FR-AUTH-07) means signing in weekly.

## Lead-time items

- Apple and Google developer account enrolment, before step 2.
- Google Play may require a closed test period for new personal developer accounts; start it in step 2. (From memory, unverified.)

## What was verified and what was not

Checked on 2026-10-12: Expo `latest` and `next` dist-tags; SDK 57 and SDK 58 beta changelogs; `openAuthSessionAsync` behaviour in the SDK 57 reference and source; expo-apple-authentication and the file-system download API in the SDK references; EAS pricing; App Store guidelines 4.8, 5.1.1(v), 4.2 and 2.5.2; the web client's files audited for browser dependencies.

Not verified, to confirm by spike: the Android redirect return on a real device; download with headers on a device; TanStack infinite-query invalidation refetching every loaded page; new-architecture status of the fallback chart library; the Google Play closed-test requirement; custom-scheme hijacking on Android.

## Amendment, 2026-10-19: local-only use

The owner decided the app will run only locally for now: the backend in the repo's Docker dev stack on the Mac, the app in the iOS Simulator through Expo Go. The stack above is unchanged. What changes:

- **SDK**: npm `latest` for Expo is 58.0.16, so the project starts on SDK 58; the scaffold-day rule above already gives this, and no mid-build upgrade is needed.
- **Runtime**: development builds, as chosen above, but compiled on the Mac with `npx expo run:ios` for the simulator; EAS Build, Submit and Update are not used. (Expo Go was considered for local use and rejected: push needs the app's own bundle identifier.)
- **Sign-in**: Google sign-in works in the iOS Simulator because its callback is on `localhost`, which Google accepts; Google rejects raw LAN IP redirect hosts, so other targets use a development-only email sign-in over the existing `POST /auth/register` and `POST /auth/login`. That sign-in is shown only in development mode with `EXPO_PUBLIC_DEV_SIGN_IN=1`.
- **End-to-end tests**: Maestro signs in through the development email sign-in, so the E2E session-injection build and its four conditions are not needed locally.
- **Backend prerequisites**: only item 2 (GAP-03, merged into the local backend) is required. Items 1 and 3 to 6 protect or enable a distributed app and are deferred.
- **Risks**: risk 2 (store blockers) is deferred; risk 7 (export) is retired on the simulator; Android-specific halves of risks 1 and the caret trade-off apply only if an Android emulator is added.

The master plan's section 15 lists everything that returns if the app is ever distributed.
- **Push notifications** (owner decision, 2026-10-19: "try push notifications"): added as an experimental phase with expo-notifications. Locally, the backend sends to a relay on the Mac that runs `xcrun simctl push` against the simulator; real APNs sandbox delivery to the simulator is possible on this Apple silicon Mac only with a paid Apple Developer Program membership. The owner has no membership (2026-10-23), so only simulated pushes are in scope; notifications show the amount (owner approved). Expo Go cannot be used for this, which is why development builds stay.
- **Targets**: iOS first; Android after v1.
