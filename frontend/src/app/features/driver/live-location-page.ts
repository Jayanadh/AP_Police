import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { MyVehicles, VehiclesApi } from '../../core/api/vehicles-api';
import { formatTime } from '../../core/format';
import { LiveLocation } from '../../core/live-location';
import { Panel } from '../../core/panel';
import { ConfirmButton } from '../../ui/confirm-button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { MapMarker, MapPath, MapView } from '../../ui/map-view';
import { PageHeader } from '../../ui/page-header';

/** The id of the "you are here" marker. */
const HERE = 0;

/**
 * The driver shares the vehicle's live location while on duty: Start asks for the duty particulars, and sharing
 * goes on (across pages, and after a reload) until the driver stops it. The MTO sees it on the live map.
 */
@Component({
  selector: 'app-live-location-page',
  imports: [ConfirmButton, EmptyState, Icon, LoadError, MapView, PageHeader],
  templateUrl: './live-location-page.html',
  styleUrl: './live-location-page.scss',
})
export class LiveLocationPage {
  protected readonly live = inject(LiveLocation);
  private readonly vehiclesApi = inject(VehiclesApi);
  private readonly injector = inject(Injector);
  private readonly dutyField = viewChild<ElementRef<HTMLTextAreaElement>>('dutyField');

  protected readonly formatTime = formatTime;
  protected readonly HERE = HERE;

  protected readonly vehicles = new Panel<MyVehicles>(() => this.vehiclesApi.myVehicles());
  protected readonly vehicle = computed(() => this.vehicles.data()?.vehicles[0] ?? null);

  /** Whether the duty particulars are being asked for. */
  protected readonly asking = signal(false);
  protected readonly duty = signal('');
  protected readonly startError = signal('');
  protected readonly stopError = signal('');

  protected readonly markers = computed<MapMarker[]>(() => {
    const here = this.live.here();
    return here
      ? [{ id: HERE, lat: here.lat, lng: here.lng, label: 'You are here', tone: 'me' }]
      : [];
  });
  protected readonly paths = computed<MapPath[]>(() => {
    const trip = this.live.trip();
    return trip ? [{ id: trip.id, points: this.live.route() }] : [];
  });
  protected readonly accuracy = computed(() => {
    const metres = this.live.trip()?.accuracy_m;
    return metres === null || metres === undefined ? '—' : `±${Math.round(metres)} m`;
  });
  protected readonly waitingText = computed(() => {
    const count = this.live.waiting();
    return `${count} ${count === 1 ? 'location' : 'locations'} waiting to be sent`;
  });

  constructor() {
    this.vehicles.load();
  }

  protected ask(): void {
    this.asking.set(true);
    this.startError.set('');
    afterNextRender(() => this.dutyField()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    this.asking.set(false);
    this.duty.set('');
    this.startError.set('');
  }

  protected async start(): Promise<void> {
    if (!this.duty().trim()) {
      this.startError.set('Enter the duty particulars.');
      return;
    }
    this.startError.set('');
    const problem = await this.live.start(this.duty());
    if (problem) {
      this.startError.set(problem);
    } else {
      this.asking.set(false);
      this.duty.set('');
    }
  }

  protected async stop(): Promise<void> {
    this.stopError.set('');
    this.stopError.set(await this.live.stop());
  }
}
