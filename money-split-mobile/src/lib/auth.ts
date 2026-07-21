import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

const API_PUBLIC = process.env.EXPO_PUBLIC_API_PUBLIC_URL!;
const CALLBACK = 'money-split://auth/callback';

export async function startGoogleLogin(): Promise<WebBrowser.WebBrowserAuthSessionResult> {
  const url = `${API_PUBLIC}/auth/google/mobile?mobile_redirect=${encodeURIComponent(CALLBACK)}`;
  return WebBrowser.openAuthSessionAsync(url, CALLBACK);
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync('jwt_token', token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync('jwt_token');
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload));
}
