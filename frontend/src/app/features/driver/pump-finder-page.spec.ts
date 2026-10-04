import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { DirectoryPump } from '../../core/api/pumps-api';
import { MyVehicles } from '../../core/api/vehicles-api';
import { GeoService, LatLng } from '../../core/geo';
import { makeMyVehicle } from '../../core/test-data';
import { MapView } from '../../ui/map-view';
import { NEVER_LOADING_LEAFLET } from '../../ui/testing/leaflet-stub';
import { PumpFinderPage } from './pump-finder-page';

/** The driver's diesel jeep: the finder asks only for the pumps that can fill diesel now. */
const MINE: MyVehicles = {
  vehicles: [makeMyVehicle({ registration_number: 'AP39PA1001', fuel_type: 'DIESEL' })],
  mto: { unit_name: 'MTO Nellore', full_name: 'Ravi Kumar', mobile: '9876543210' },
};
const DIRECTORY_URL = '/api/pump-directory/?fuel=DIESEL';
const HERE: LatLng = { lat: 14.4426, lng: 79.9865 };

const pump = (overrides: Partial<DirectoryPump> = {}): DirectoryPump => ({
  id: 3,
  name: 'Nellore Police Pump',
  kind: 'POLICE',
  kind_label: 'Police pump',
  address: 'Police Lines, Nellore',
  district_name: 'Nellore',
  unit_name: 'MTO Nellore',
  latitude: '14.450000',
  longitude: '79.990000',
  opening_hours: '24/7',
  sells_petrol: true,
  sells_diesel: true,
  petrol_available: true,
  diesel_available: true,
  ...overrides,
});

// About 0.9 km, 53 km and 213 km from HERE; by name the order is Guntur, Kavali, Nellore.
const NELLORE = pump();
const KAVALI = pump({
  id: 4,
  name: 'Kavali Bunk',
  kind: 'TIE_UP',
  kind_label: 'Tie-up bunk',
  address: 'NH16, Kavali',
  latitude: '14.915000',
  longitude: '79.992000',
  opening_hours: '6 am – 10 pm',
  sells_diesel: false,
  diesel_available: false,
});
const GUNTUR = pump({
  id: 7,
  name: 'Guntur Police Pump',
  address: 'Arundelpet',
  district_name: 'Guntur',
  unit_name: 'MTO Guntur',
  latitude: '16.306700',
  longitude: '80.436500',
  sells_petrol: false,
  petrol_available: false,
});

/** Answers each call for the position with the next of `answers` (null: location unavailable). */
class GeoStub {
  calls = 0;
  constructor(private readonly answers: (LatLng | null)[]) {}
  current(): Promise<LatLng | null> {
    this.calls++;
    return Promise.resolve(this.answers.length > 1 ? this.answers.shift()! : this.answers[0]);
  }
}

describe('PumpFinderPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function setup(
    positions: (LatLng | null)[] = [HERE],
    rows: DirectoryPump[] | 'fail' = [NELLORE, KAVALI, GUNTUR],
    mine: MyVehicles = MINE,
  ) {
    const geo = new GeoStub(positions);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        NEVER_LOADING_LEAFLET,
        { provide: GeoService, useValue: geo },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigated: string[] = [];
    router.navigateByUrl = (url) => {
      navigated.push(String(url));
      return Promise.resolve(true);
    };
    const fixture = TestBed.createComponent(PumpFinderPage);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    http.expectOne('/api/me/vehicles/').flush(mine);
    await fixture.whenStable();
    const directoryUrl = mine.vehicles.length ? DIRECTORY_URL : '/api/pump-directory/';
    const reply = async (body: DirectoryPump[] | 'fail') => {
      const req = http.expectOne(directoryUrl);
      expect(req.request.method).toBe('GET');
      if (body === 'fail') {
        req.flush({ detail: 'Not available.' }, { status: 500, statusText: 'Server' });
      } else {
        req.flush(body);
      }
      await fixture.whenStable();
    };
    await reply(rows);
    const text = (node: Element | null | undefined) =>
      node?.textContent?.replace(/\s+/g, ' ').trim();
    const cards = () => Array.from(el.querySelectorAll<HTMLAnchorElement>('.carousel a.pump-card'));
    const listRows = () =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('.nearest a.pump-row'));
    const names = (items: HTMLElement[]) =>
      items.map((item) => text(item.querySelector('.pump-name')));
    const button = (label: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => text(b) === label || b.getAttribute('aria-label') === label,
      );
    const search = async (term: string) => {
      const input = el.querySelector<HTMLInputElement>('#pump-search')!;
      input.value = term;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const map = () =>
      fixture.debugElement.query(By.directive(MapView)).componentInstance as MapView;
    return {
      fixture,
      el,
      http,
      geo,
      navigated,
      reply,
      text,
      cards,
      listRows,
      names,
      button,
      search,
      map,
    };
  }

  it('lists the pumps nearest first, with the distance and the travel time', async () => {
    const { el, text, cards, listRows, names } = await setup();
    expect(text(el.querySelector('h1'))).toBe('Found 3 petrol stations near you');
    expect(names(cards())).toEqual(['Nellore Police Pump', 'Kavali Bunk', 'Guntur Police Pump']);
    const first = cards()[0];
    expect(text(first.querySelector('.pump-distance'))).toBe('0.9 km');
    expect(text(first.querySelector('.pump-time'))).toBe('2 mins');
    expect(text(cards()[1].querySelector('.pump-distance'))).toBe('53 km');
    expect(text(cards()[1].querySelector('.pump-time'))).toBe('1 h 46 mins');
    expect(text(el.querySelector('.nearest-title'))).toBe('Most nearest');
    expect(names(listRows())).toEqual(['Nellore Police Pump', 'Kavali Bunk', 'Guntur Police Pump']);
    expect(text(listRows()[2].querySelector('.pump-distance'))).toBe('213 km');
    expect(el.querySelector('.location-note')).toBeNull();
  });

  it('shows each pump with its kind, where it is, and a link to it', async () => {
    const { text, cards, listRows } = await setup();
    const [nellore, kavali] = cards();
    expect(text(nellore.querySelector('.badge'))).toBe('Police pump');
    expect(text(kavali.querySelector('.badge'))).toBe('Tie-up bunk');
    expect(text(nellore.querySelector('.pump-where'))).toBe('Police Lines, Nellore');
    expect(nellore.getAttribute('href')).toBe('/driver/pumps/3');
    expect(kavali.getAttribute('href')).toBe('/driver/pumps/4');
    expect(listRows()[0].getAttribute('href')).toBe('/driver/pumps/3');
  });

  it('shows dashes, sorts by name and asks for the location when there is none', async () => {
    const { el, text, cards, listRows, names, button, fixture, geo } = await setup([null, HERE]);
    expect(names(cards())).toEqual(['Guntur Police Pump', 'Kavali Bunk', 'Nellore Police Pump']);
    expect(cards().map((card) => text(card.querySelector('.pump-distance')))).toEqual([
      '—',
      '—',
      '—',
    ]);
    expect(text(cards()[0].querySelector('.pump-time'))).toBe('—');
    expect(text(el.querySelector('.nearest-title'))).toBe('All pumps');
    expect(names(listRows())).toEqual(['Guntur Police Pump', 'Kavali Bunk', 'Nellore Police Pump']);
    expect(text(el.querySelector('.location-note'))).toContain(
      'Turn on location to see the nearest pumps.',
    );

    button('Use my location')!.click();
    await fixture.whenStable();
    expect(geo.calls).toBe(2);
    expect(names(cards())).toEqual(['Nellore Police Pump', 'Kavali Bunk', 'Guntur Police Pump']);
    expect(el.querySelector('.location-note')).toBeNull();
  });

  it("shows only the pumps that can fill the driver's vehicle now, and says so", async () => {
    const { el, text } = await setup();
    expect(el.querySelector('.fuel-chips')).toBeNull();
    expect(text(el.querySelector('.for-vehicle'))).toBe(
      'Pumps that can fill AP39PA1001 with diesel now.',
    );
  });

  it('shows every open pump to a driver who has no vehicle yet', async () => {
    const { text, el, cards } = await setup([HERE], [NELLORE, KAVALI, GUNTUR], {
      ...MINE,
      vehicles: [],
    });
    expect(cards()).toHaveLength(3);
    expect(text(el.querySelector('.for-vehicle'))).toBe(
      'You are not linked to a vehicle yet, so every pump is shown.',
    );
  });

  it('filters the pumps by name, address or district as the driver types', async () => {
    const { el, text, cards, names, search } = await setup();
    await search('kavali');
    expect(names(cards())).toEqual(['Kavali Bunk']);
    expect(text(el.querySelector('h1'))).toBe('Found 1 petrol station near you');

    await search('  POLICE LINES ');
    expect(names(cards())).toEqual(['Nellore Police Pump']);

    await search('guntur');
    expect(names(cards())).toEqual(['Guntur Police Pump']);

    // By district: Kavali is in Nellore district too.
    await search('nellore');
    expect(names(cards())).toEqual(['Nellore Police Pump', 'Kavali Bunk']);
  });

  it('says so when nothing matches, and clears the search on request', async () => {
    const { el, text, cards, search, button, fixture } = await setup();
    await search('vizag');
    expect(cards()).toHaveLength(0);
    expect(text(el.querySelector('h1'))).toBe('Found 0 petrol stations near you');
    expect(text(el.querySelector('app-empty-state'))).toContain('No pumps match your search.');

    button('Clear search')!.click();
    await fixture.whenStable();
    expect(cards()).toHaveLength(3);
    expect(el.querySelector<HTMLInputElement>('#pump-search')!.value).toBe('');
  });

  it('opens and closes the search box from its round button', async () => {
    const { el, button, fixture } = await setup();
    const finder = el.querySelector('.finder')!;
    const toggle = button('Search pumps')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(finder.classList).not.toContain('search-open');
    toggle.click();
    await fixture.whenStable();
    expect(finder.classList).toContain('search-open');
    expect(button('Close search')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('pump-search');
    button('Close search')!.click();
    await fixture.whenStable();
    expect(finder.classList).not.toContain('search-open');
  });

  it('puts the pumps and the driver on a map that can be dragged with one finger', async () => {
    const { map, search } = await setup();
    expect(map().touchDrag()).toBe(true);
    const markers = map().markers();
    expect(markers.map((m) => m.id)).toEqual([3, 4, 7, -1]);
    expect(markers[0]).toEqual(
      expect.objectContaining({
        lat: 14.45,
        lng: 79.99,
        label: 'Nellore Police Pump',
        tone: 'police',
      }),
    );
    expect(markers[1].tone).toBe('tieup');
    expect(markers[3]).toEqual(
      expect.objectContaining({ lat: HERE.lat, lng: HERE.lng, label: 'You are here', tone: 'me' }),
    );
    expect(map().center()).toEqual(HERE);

    // The map shows the pumps that match the search.
    await search('police');
    expect(
      map()
        .markers()
        .map((m) => m.id),
    ).toEqual([3, 7, -1]);
  });

  it('fits the map to the matches while searching, and goes back to the driver after', async () => {
    const { map, search } = await setup();
    await search('guntur');
    expect(map().center()).toBeNull();
    expect(
      map()
        .markers()
        .map((m) => m.id),
    ).toEqual([7, -1]);
    await search('');
    expect(map().center()).toEqual(HERE);
  });

  it('fits the map to the pumps when the location is unknown', async () => {
    const { map } = await setup([null]);
    expect(map().center()).toBeNull();
    expect(
      map()
        .markers()
        .map((m) => m.id),
    ).toEqual([7, 4, 3]);
  });

  it('opens the pump whose pin is tapped, and ignores a tap on the driver', async () => {
    const { map, navigated } = await setup();
    map().markerClick.emit(4);
    expect(navigated).toEqual(['/driver/pumps/4']);
    map().markerClick.emit(-1);
    expect(navigated).toEqual(['/driver/pumps/4']);
  });

  it('asks for the position again from the round locate button', async () => {
    const { button, fixture, geo, map } = await setup([null, HERE]);
    expect(map().center()).toBeNull();
    button('Show my location')!.click();
    await fixture.whenStable();
    expect(geo.calls).toBe(2);
    expect(map().center()).toEqual(HERE);
  });

  it('shows the error with a retry when the pumps cannot be read', async () => {
    const { el, text, button, reply, fixture, cards } = await setup([HERE], 'fail');
    expect(text(el.querySelector('[role="alert"]'))).toBe('Not available.');
    button('Try again')!.click();
    await fixture.whenStable();
    await reply([NELLORE]);
    expect(cards()).toHaveLength(1);
  });
});
