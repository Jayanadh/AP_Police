import { HttpInterceptorFn } from '@angular/common/http';
import { inject, InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../environments/environment';

/** Whether this is the Android or iOS app (built with Capacitor), rather than the web app in a browser. */
export const NATIVE_APP = new InjectionToken<boolean>('NATIVE_APP', {
  providedIn: 'root',
  factory: () => Capacitor.isNativePlatform(),
});

const DEVICE_NAMES: Readonly<Record<string, string>> = { android: 'Android phone', ios: 'iPhone' };

/** What the phone apps call this device when they sign in, so a person can tell their devices apart. */
export const DEVICE_NAME = new InjectionToken<string>('DEVICE_NAME', {
  providedIn: 'root',
  factory: () => DEVICE_NAMES[Capacitor.getPlatform()] ?? 'Phone',
});

/** The server the API is on: none for the web app (its own server), the full address in the phone apps. */
export const API_BASE = new InjectionToken<string>('API_BASE', {
  providedIn: 'root',
  factory: () => environment.apiBase,
});

/** In the phone apps, sends the `/api/` calls to the server: the app's own pages are on the phone. */
export const apiAddressInterceptor: HttpInterceptorFn = (req, next) => {
  const base = inject(API_BASE);
  return base && req.url.startsWith('/api/') ? next(req.clone({ url: base + req.url })) : next(req);
};
