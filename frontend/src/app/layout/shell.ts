import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  InjectionToken,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, EMPTY, filter, interval, merge, of, switchMap } from 'rxjs';
import { NotificationsApi } from '../core/api/notifications-api';
import { AuthStore, ROLE_LABELS } from '../core/auth-store';
import { Icon } from '../ui/icon';
import { homePathFor, navItemsFor } from './nav';

/** How often the unread-alert count is refreshed. Override it in tests. */
export const UNREAD_POLL_MS = new InjectionToken<number>('UNREAD_POLL_MS', {
  providedIn: 'root',
  factory: () => 60_000,
});

const BOTTOM_BAR_ITEMS = 4;
const BADGE_MAX = 99;

/** The signed-in frame: sidebar from 900 px, top bar and floating bottom navigation below. The top bar ends with the
 * Alerts bell and Profile on every screen size. */
@Component({
  selector: 'app-shell',
  imports: [Icon, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '(document:keydown.escape)': 'dismissMore()',
    // Another tab may have signed out, or signed someone else in, while this one was away.
    '(window:focus)': 'recheckSession()',
    '(document:visibilitychange)': 'recheckSession()',
  },
})
export class Shell {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsApi);
  private readonly injector = inject(Injector);
  private readonly pollMs = inject(UNREAD_POLL_MS);
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly moreButton = viewChild<ElementRef<HTMLButtonElement>>('moreButton');

  protected readonly user = this.auth.user;
  protected readonly items = computed(() => {
    const user = this.user();
    return user ? navItemsFor(user) : [];
  });
  protected readonly bottomItems = computed(() =>
    this.items()
      .filter((item) => item.primary)
      .slice(0, BOTTOM_BAR_ITEMS),
  );
  protected readonly home = computed(() => {
    const role = this.auth.role();
    return role ? homePathFor(role) : '/';
  });
  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  protected readonly unread = signal(0);
  protected readonly unreadText = computed(() =>
    this.unread() > BADGE_MAX ? `${BADGE_MAX}+` : String(this.unread()),
  );
  protected readonly bellLabel = computed(() =>
    this.unread() > 0 ? `Alerts, ${this.unread()} unread` : 'Alerts',
  );
  protected readonly moreOpen = signal(false);

  constructor() {
    const navigated = this.router.events.pipe(filter((event) => event instanceof NavigationEnd));

    // Now, then every minute, after each page change and after alerts are marked read.
    merge(of(0), interval(this.pollMs), navigated, this.notifications.changes$)
      .pipe(
        switchMap(() => this.notifications.unreadCount().pipe(catchError(() => EMPTY))),
        takeUntilDestroyed(),
      )
      .subscribe((count) => this.unread.set(count));

    navigated.pipe(takeUntilDestroyed()).subscribe(() => this.moreOpen.set(false));
  }

  protected openMore(): void {
    this.moreOpen.set(true);
    afterNextRender(() => this.sheet()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Closes the sheet because the user dismissed it, and returns focus to the button that opened it. */
  protected dismissMore(): void {
    if (!this.moreOpen()) {
      return;
    }
    this.moreOpen.set(false);
    afterNextRender(() => this.moreButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeMore(): void {
    this.moreOpen.set(false);
  }

  protected recheckSession(): void {
    if (document.visibilityState !== 'hidden') {
      void this.auth.recheckSession();
    }
  }

  protected logout(): void {
    this.auth.signOut();
  }
}
