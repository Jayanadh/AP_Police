import { HttpInterceptorFn } from '@angular/common/http';
import { inject, InjectionToken, Service } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/** Where the phone apps keep their sign-in between launches. */
export interface TokenVault {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'mto.device-token';

/** The phone's own secure storage: the iOS Keychain, or values encrypted with the Android Keystore. */
const secureStorage: TokenVault = {
  read: () =>
    SecureStoragePlugin.get({ key: KEY })
      .then((stored) => stored.value)
      .catch(() => null), // nothing kept yet
  write: (token) => SecureStoragePlugin.set({ key: KEY, value: token }).then(() => undefined),
  clear: () =>
    SecureStoragePlugin.remove({ key: KEY })
      .then(() => undefined)
      .catch(() => undefined),
};

export const TOKEN_VAULT = new InjectionToken<TokenVault>('TOKEN_VAULT', {
  providedIn: 'root',
  factory: () => secureStorage,
});

/**
 * The phone apps' sign-in: a device token from the server (see docs/mobile-apps.md), sent with every API call. The
 * web app signs in with a session cookie instead and never has one.
 */
@Service()
export class DeviceToken {
  private readonly vault = inject(TOKEN_VAULT);
  private token: string | null = null;

  current(): string | null {
    return this.token;
  }

  /** Reads the token kept on the phone, as the app starts. */
  async restore(): Promise<void> {
    this.token = await this.vault.read();
  }

  async keep(token: string): Promise<void> {
    this.token = token;
    await this.vault.write(token);
  }

  async forget(): Promise<void> {
    this.token = null;
    await this.vault.clear();
  }
}

/** Signs the API calls in with the device token, when there is one. It goes to the API and nowhere else. */
export const deviceTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(DeviceToken).current();
  return token && req.url.startsWith('/api/')
    ? next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))
    : next(req);
};
