import { InjectionToken } from '@angular/core';

/**
 * The current moment. Components that ask "is this today?" read it from here instead of `new Date()`,
 * so a spec can fix it (see `fixedClock` in test-data.ts) and not depend on the hour it runs at.
 */
export const NOW = new InjectionToken<() => Date>('NOW', {
  providedIn: 'root',
  factory: () => () => new Date(),
});
