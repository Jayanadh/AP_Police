import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { Trip } from '../../core/api/tracking-api';
import { LatLng } from '../../core/geo';
import { LiveLocation, SharingState } from '../../core/live-location';
import { makeTrip, makeVehicle } from '../../core/test-data';
import { CONFIRM_GUARD_MS } from '../../ui/confirm-button';
import { MapView } from '../../ui/map-view';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { LiveLocationPage } from './live-location-page';

const pastGuard = () => new Promise((resolve) => setTimeout(resolve, CONFIRM_GUARD_MS + 50));
const REFUSED = "Precise location is off for this app. Allow it in the phone's settings.";

/** Stands in for the live location service, so the page is tested on its own. */
class FakeLive {
  state = signal<SharingState>('off');
  trip = signal<Trip | null>(null);
  here = signal<LatLng | null>(null);
  route = signal<LatLng[]>([]);
  waiting = signal(0);
  locationProblem = signal('');
  sendProblem = signal('');
  ended = signal('');
  screenKeptOn = signal(false);
  inBackground = false;
  carriesOnClosed = false;
  canOpenSettings = false;
  settingsOpened = 0;
  /** As the service: the phone apps' settings help with location refused, and nothing else. */
  settingsHelpWith(problem: string) {
    return this.canOpenSettings && problem.startsWith(REFUSED);
  }

  started: string[] = [];
  startAnswer = '';
  stops = 0;
  stopAnswer = '';
  checks = 0;

  async start(duty: string) {
    this.started.push(duty);
    return this.startAnswer;
  }
  async stop() {
    this.stops++;
    return this.stopAnswer;
  }
  check() {
    this.checks++;
  }
  async openSettings() {
    this.settingsOpened++;
  }

  /** Puts the fake into "sharing" for the default trip. */
  sharing(overrides: Partial<Trip> = {}) {
    this.state.set('on');
    this.trip.set(makeTrip(overrides));
    this.here.set({ lat: 14.4426, lng: 79.9865 });
    this.route.set([
      { lat: 14.43, lng: 79.98 },
      { lat: 14.4426, lng: 79.9865 },
    ]);
  }
}

describe('LiveLocationPage', () => {
  let live: FakeLive;

  beforeEach(() => {
    live = new FakeLive();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        NEVER_LOADING_LEAFLET,
        { provide: LiveLocation, useValue: live },
      ],
    });
  });

  async function setup(vehicles = [makeVehicle({ registration_number: 'AP39PA1001' })]) {
    const fixture = TestBed.createComponent(LiveLocationPage);
    await fixture.whenStable();
    TestBed.inject(HttpTestingController)
      .match('/api/me/vehicles/')
      .forEach((req) =>
        req.flush({ vehicles, mto: { unit_name: 'MTO Nellore', full_name: null, mobile: null } }),
      );
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = () => el.textContent?.replace(/\s+/g, ' ') ?? '';
    const button = (label: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    const map = () =>
      fixture.debugElement.query(By.directive(MapView))?.componentInstance as MapView | undefined;
    return { fixture, el, text, button, map };
  }

  describe('when off', () => {
    it('asks for the duty particulars once Start is pressed, then starts with them', async () => {
      const { fixture, el, button } = await setup();
      expect(el.querySelector('textarea')).toBeNull();

      button('Start live location')!.click();
      await fixture.whenStable();
      const duty = el.querySelector<HTMLTextAreaElement>('#duty-particulars')!;
      expect(document.activeElement).toBe(duty);
      duty.value = 'Night patrol, Kavali highway';
      duty.dispatchEvent(new Event('input'));
      button('OK')!.click();
      await fixture.whenStable();

      expect(live.started).toEqual(['Night patrol, Kavali highway']);
    });

    it('needs the duty particulars before it starts', async () => {
      const { fixture, text, button } = await setup();
      button('Start live location')!.click();
      await fixture.whenStable();

      button('OK')!.click();
      await fixture.whenStable();

      expect(live.started).toEqual([]);
      expect(text()).toContain('Enter the duty particulars.');
    });

    it('offers the phone’s settings when location was refused as it started', async () => {
      live.canOpenSettings = true;
      live.startAnswer = `${REFUSED} Then start again.`;
      const { fixture, el, button } = await setup();
      button('Start live location')!.click();
      await fixture.whenStable();
      const duty = el.querySelector<HTMLTextAreaElement>('#duty-particulars')!;
      duty.value = 'Patrol';
      duty.dispatchEvent(new Event('input'));
      button('OK')!.click();
      await fixture.whenStable();

      button('Open settings')!.click();
      expect(live.settingsOpened).toBe(1);
    });

    it('offers no settings for a reason they cannot put right', async () => {
      live.canOpenSettings = true;
      live.startAnswer = 'You are not linked to a vehicle. Contact your MTO.';
      const { fixture, el, text, button } = await setup();
      button('Start live location')!.click();
      await fixture.whenStable();
      const duty = el.querySelector<HTMLTextAreaElement>('#duty-particulars')!;
      duty.value = 'Patrol';
      duty.dispatchEvent(new Event('input'));
      button('OK')!.click();
      await fixture.whenStable();

      expect(text()).toContain('You are not linked to a vehicle.');
      expect(button('Open settings')).toBeUndefined();
    });

    it('says why it could not start', async () => {
      live.startAnswer =
        "Location is blocked for this site. Allow it in the browser's site settings.";
      const { fixture, el, text, button } = await setup();
      button('Start live location')!.click();
      await fixture.whenStable();
      const duty = el.querySelector<HTMLTextAreaElement>('#duty-particulars')!;
      duty.value = 'Escort duty';
      duty.dispatchEvent(new Event('input'));

      button('OK')!.click();
      await fixture.whenStable();

      expect(text()).toContain('Location is blocked for this site.');
    });

    it('puts the Start button back on Cancel', async () => {
      const { fixture, el, button } = await setup();
      button('Start live location')!.click();
      await fixture.whenStable();
      button('Cancel')!.click();
      await fixture.whenStable();
      expect(el.querySelector('textarea')).toBeNull();
      expect(button('Start live location')).toBeDefined();
    });

    it('shows that it is getting the location while starting', async () => {
      live.state.set('starting');
      const { button } = await setup();
      expect(button('Getting your location…')?.disabled).toBe(true);
    });

    it('tells a driver with no vehicle to see their MTO', async () => {
      const { text, button } = await setup([]);
      expect(text()).toContain('You are not linked to a vehicle yet.');
      expect(button('Start live location')).toBeUndefined();
    });

    it('says why sharing stopped when it was stopped from elsewhere', async () => {
      live.ended.set('This trip has ended. No location for 12 hours.');
      const { text } = await setup();
      expect(text()).toContain('This trip has ended. No location for 12 hours.');
    });
  });

  it('shows a note while it checks', async () => {
    live.state.set('checking');
    const { text } = await setup();
    expect(text()).toContain('Checking your live location…');
  });

  it('offers to try again when the check failed', async () => {
    live.state.set('unknown');
    const { fixture, button } = await setup();
    button('Try again')!.click();
    await fixture.whenStable();
    expect(live.checks).toBe(1);
  });

  describe('while sharing', () => {
    it('shows the vehicle, the duty, since when, and the newest location sent', async () => {
      live.sharing({ last_point_at: '2026-10-04T10:11:00+05:30' });
      const { el, text } = await setup();
      expect(text()).toContain('Sharing your live location');
      expect(text()).toContain('AP39PA1001');
      expect(text()).toContain('Night patrol, Kavali highway');
      expect(text()).toContain('Since 9:00 am');
      const facts = Array.from(el.querySelectorAll('.facts div')).map((fact) => [
        fact.querySelector('dt')?.textContent?.trim(),
        fact.querySelector('dd')?.textContent?.trim(),
      ]);
      expect(facts).toEqual([
        ['Last location sent', '10:11 am'],
        ['Accuracy', '±8 m'],
      ]);
    });

    it('shows where the phone is and the route on a map that follows it', async () => {
      live.sharing();
      const { map } = await setup();
      const view = map()!;
      expect(view.markers()).toEqual([
        { id: 0, lat: 14.4426, lng: 79.9865, label: 'You are here', tone: 'me' },
      ]);
      expect(view.paths()).toEqual([{ id: 41, points: live.route() }]);
      expect(view.follow()).toBe(0);
    });

    it('says nothing of the few locations waiting between sends while sending goes well', async () => {
      live.sharing();
      live.waiting.set(2);
      const { text } = await setup();
      expect(text()).not.toContain('waiting to be sent');
    });

    it('says how many locations wait to be sent, and any problem', async () => {
      live.sharing();
      live.waiting.set(3);
      live.sendProblem.set(
        'No connection. Locations are kept on this phone and sent once it is back.',
      );
      live.locationProblem.set('Looking for your location. Make sure location (GPS) is on.');
      const { text } = await setup();
      expect(text()).toContain('3 locations waiting to be sent');
      expect(text()).toContain('No connection.');
      expect(text()).toContain('Looking for your location.');
    });

    it('is honest that the page has to stay open on screen', async () => {
      live.sharing();
      const { fixture, text } = await setup();
      expect(text()).toContain('Keep this page open with the screen on');
      live.screenKeptOn.set(true);
      await fixture.whenStable();
      expect(text()).toContain('The screen stays on while this page is open');
    });

    it('in the Android app, says sharing goes on with the screen locked and the app closed', async () => {
      live.sharing();
      live.inBackground = true;
      live.carriesOnClosed = true;
      const { text } = await setup();
      expect(text()).toContain(
        'Sharing goes on with the screen locked, another app open or the app closed. A notification shows while it does.',
      );
      expect(text()).not.toContain('Keep this page open');
    });

    it('in the iPhone app, says swiping the app away stops it', async () => {
      live.sharing();
      live.inBackground = true;
      const { text } = await setup();
      expect(text()).toContain(
        'Sharing goes on with the screen locked or another app open. Swiping the app away stops it until you open the app again.',
      );
      expect(text()).not.toContain('Keep this page open');
    });

    it('in the phone app, opens the phone’s settings when location is off', async () => {
      live.sharing();
      live.canOpenSettings = true;
      live.locationProblem.set(REFUSED);
      const { fixture, button } = await setup();
      button('Open settings')!.click();
      await fixture.whenStable();
      expect(live.settingsOpened).toBe(1);
    });

    it('in the phone app, offers no settings while a mock location app sets the location', async () => {
      live.sharing();
      live.canOpenSettings = true;
      live.locationProblem.set(
        "Another app is setting this phone's location (a mock location app). Turn it off to share where the vehicle really is.",
      );
      const { text, button } = await setup();
      expect(text()).toContain("Another app is setting this phone's location");
      expect(button('Open settings')).toBeUndefined();
    });

    it('stops after a second tap', async () => {
      live.sharing();
      const { fixture, button } = await setup();
      button('Stop live location')!.click();
      await fixture.whenStable();
      expect(live.stops).toBe(0);
      await pastGuard();
      button('Tap again to stop')!.click();
      await fixture.whenStable();
      expect(live.stops).toBe(1);
    });

    it('says why it could not stop', async () => {
      live.sharing();
      live.stopAnswer = 'Cannot reach the server. Check your connection.';
      const { fixture, text, button } = await setup();
      button('Stop live location')!.click();
      await pastGuard();
      button('Tap again to stop')!.click();
      await fixture.whenStable();
      expect(text()).toContain('Cannot reach the server. Check your connection.');
    });
  });
});
