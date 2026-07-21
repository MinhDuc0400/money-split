# Split Money — Mobile

React Native + Expo companion to the Split Money web app. iOS and Android.

## Stack

| Layer | Tech |
|---|---|
| Framework | Expo SDK 52 + Expo Router |
| State | Redux Toolkit + redux-persist |
| Real-time | socket.io-client 4.8.x |
| Auth | Google OAuth via expo-web-browser deep link |
| Storage | expo-secure-store (JWT) + AsyncStorage (Redux persist) |

## Getting Started

```bash
cd money-split-mobile
npm install
cp .env.example .env   # fill EXPO_PUBLIC_API_URL and EXPO_PUBLIC_API_PUBLIC_URL
npx expo start
```

Scan the QR code with Expo Go, or press `i` for iOS simulator / `a` for Android emulator.

## Environment Variables

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | NestJS backend base URL |
| `EXPO_PUBLIC_API_PUBLIC_URL` | Publicly reachable backend URL (used for OAuth redirect) |

## Deep Links

- `money-split://auth/callback?token=<jwt>` — OAuth callback
- `money-split://join/<code>` — Prefills invite code on Join screen
