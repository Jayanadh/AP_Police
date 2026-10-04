/**
 * The Android app on the Android emulator (`npm run build:emulator`), for trying it against the development server
 * on this computer: the emulator reaches the computer at 10.0.2.2. Debug builds only allow this plain HTTP.
 */
export const environment = {
  apiBase: 'http://10.0.2.2:8000',
};
