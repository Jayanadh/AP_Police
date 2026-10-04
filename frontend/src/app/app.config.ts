import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AuthStore } from './core/auth-store';
import { deviceTokenInterceptor } from './core/device-token';
import { apiAddressInterceptor } from './core/native';
import { sessionInterceptor } from './core/session-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // In the phone apps the API calls carry the device token and go to the server's address.
    provideHttpClient(
      withInterceptors([sessionInterceptor, deviceTokenInterceptor, apiAddressInterceptor]),
    ),
    // Ask the server who is signed in before the first navigation, so the guards know.
    provideAppInitializer(() => inject(AuthStore).loadSession()),
  ],
};
