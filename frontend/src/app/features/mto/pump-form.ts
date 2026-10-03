import { toSignal } from '@angular/core/rxjs-interop';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrorMessage } from '../../core/api-error';
import { MastersApi, MasterItem } from '../../core/api/masters-api';
import { Pump, PumpKind, PumpPayload, PumpsApi, pumpTone } from '../../core/api/pumps-api';
import { LatLng, roundCoordinate } from '../../core/geo';
import { Panel } from '../../core/panel';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { MapMarker, MapView } from '../../ui/map-view';

/** Where the map opens when a pump is added: Nellore. */
const NELLORE: LatLng = { lat: 14.4426, lng: 79.9865 };
/** The map is zoomed in far enough to place a pin on a building. */
const PICK_ZOOM = 14;

const DEFAULT_HOURS = '24/7';

// The server refuses points outside this box; checking here saves the round trip.
const AP_LATITUDE = [12.5, 19.5];
const AP_LONGITUDE = [76.5, 84.9];

const INCOMPLETE = 'Fill in the name, address, district and location.';
const NO_FUEL = 'Choose at least one fuel.';
const OUTSIDE_AP = 'Pick a location inside Andhra Pradesh.';

type Fuel = 'sells_petrol' | 'sells_diesel';

const KINDS: readonly { value: PumpKind; label: string; hint: string; icon: string }[] = [
  { value: 'POLICE', label: 'Police pump', hint: 'Keeps its own fuel stock.', icon: 'shield' },
  {
    value: 'TIE_UP',
    label: 'Tie-up bunk',
    hint: 'A private bunk with no stock here.',
    icon: 'fuel',
  },
];

const FUELS: readonly { key: Fuel; id: string; label: string }[] = [
  { key: 'sells_petrol', id: 'pump-sells-petrol', label: 'Petrol' },
  { key: 'sells_diesel', id: 'pump-sells-diesel', label: 'Diesel' },
];

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function inside(value: number, [low, high]: number[]): boolean {
  return value >= low && value <= high;
}

/** Adds a pump, or changes one. The page decides what happens after it is saved. */
@Component({
  selector: 'app-pump-form',
  imports: [Icon, LoadError, MapView, ReactiveFormsModule],
  templateUrl: './pump-form.html',
  styles: `
    :host {
      display: block;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    h2 {
      font-size: 18px;
    }

    h3 {
      font-size: 15px;
    }

    fieldset {
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }

    .group-label {
      display: block;
      padding: 0;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }

    .kind-cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .kind-card {
      position: relative;
      display: flex;
      min-width: 0;
      cursor: pointer;

      // The real radio stays in the page for keyboards and screen readers; the card shows its state.
      input {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        opacity: 0;
      }
    }

    .kind-body {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      min-width: 0;
      padding: 16px;
      border: 2px solid transparent;
      border-radius: var(--radius-md);
      background: var(--surface-2);
      transition:
        border-color 0.15s ease,
        background-color 0.15s ease;

      strong {
        font-size: 16px;
      }

      .muted {
        font-size: 13px;
        overflow-wrap: anywhere;
      }
    }

    input:checked + .kind-body {
      border-color: var(--primary-strong);
      background: color-mix(in srgb, var(--primary) 16%, white);
    }

    input:focus-visible + .kind-body {
      outline: 2px solid var(--primary-strong);
      outline-offset: 2px;
    }

    .fuel-checks {
      display: flex;
      flex-wrap: wrap;
      gap: 0 28px;
    }

    .location {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
})
export class PumpForm {
  private readonly api = inject(PumpsApi);
  private readonly masters = inject(MastersApi);
  private readonly fb = inject(NonNullableFormBuilder);

  /** The pump to change; leave empty to add a new one. */
  readonly pump = input<Pump | null>(null);
  readonly saved = output<Pump>();
  readonly cancelled = output<void>();

  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');

  protected readonly kinds = KINDS;
  protected readonly fuels = FUELS;
  protected readonly pickZoom = PICK_ZOOM;
  protected readonly adding = computed(() => this.pump() === null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly districtList = new Panel<MasterItem[]>(() => this.masters.list('districts'));
  /** The active districts, plus the pump's own when it has since been switched off. */
  protected readonly districts = computed<MasterItem[]>(() => {
    const list = this.districtList.data() ?? [];
    const pump = this.pump();
    if (pump && !list.some((district) => district.id === pump.district)) {
      return [...list, { id: pump.district, name: pump.district_name, is_active: false }];
    }
    return list;
  });

  protected readonly form = this.fb.group({
    name: ['', Validators.required],
    kind: ['POLICE' as PumpKind, Validators.required],
    address: ['', Validators.required],
    district: [null as number | null, Validators.required],
    opening_hours: [DEFAULT_HOURS],
    // nothing ticked: the MTO says what the pump sells, rather than unticking what it does not
    sells_petrol: [false],
    sells_diesel: [false],
    latitude: [null as number | null, Validators.required],
    longitude: [null as number | null, Validators.required],
  });

  private readonly values = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Where the map looks. Clicking on the map does not move it; typing a location does. */
  protected readonly mapCenter = signal<LatLng>(NELLORE);

  /** The pin for the chosen location, drawn as the kind of pump being added. */
  protected readonly markers = computed<MapMarker[]>(() => {
    const { latitude, longitude, name, kind } = this.values();
    if (!isNumber(latitude) || !isNumber(longitude)) {
      return [];
    }
    return [
      {
        id: 0,
        lat: latitude,
        lng: longitude,
        label: name?.trim() || 'New pump',
        tone: kind ? pumpTone(kind) : 'police',
      },
    ];
  });

  constructor() {
    this.districtList.load();
    effect(() => {
      const pump = this.pump();
      untracked(() => this.fillFrom(pump));
    });
    // The first field is ready for typing whenever the form appears or another pump is chosen.
    effect(() => {
      this.pump();
      this.nameField()?.nativeElement.focus();
    });
  }

  private fillFrom(pump: Pump | null): void {
    this.error.set('');
    if (pump === null) {
      this.form.reset();
      this.mapCenter.set(NELLORE);
      return;
    }
    const point = { lat: Number(pump.latitude), lng: Number(pump.longitude) };
    this.form.reset({
      name: pump.name,
      kind: pump.kind,
      address: pump.address,
      district: pump.district,
      opening_hours: pump.opening_hours,
      sells_petrol: pump.sells_petrol,
      sells_diesel: pump.sells_diesel,
      latitude: point.lat,
      longitude: point.lng,
    });
    this.mapCenter.set(point);
  }

  /** The location was picked on the map: the numbers follow, and the map stays where it is. */
  protected pick(point: LatLng): void {
    this.form.patchValue({ latitude: point.lat, longitude: point.lng });
    this.form.markAsDirty();
  }

  /** The numbers were typed: move the map to them once both make sense. */
  protected typed(latitude: string, longitude: string): void {
    if (!latitude.trim() || !longitude.trim()) {
      return;
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.mapCenter.set({ lat, lng });
    }
  }

  /** What is wrong with the form, or an empty string when it can be sent. */
  private problem(): string {
    if (this.form.invalid) {
      return INCOMPLETE;
    }
    const value = this.form.getRawValue();
    if (!value.sells_petrol && !value.sells_diesel) {
      return NO_FUEL;
    }
    if (!inside(value.latitude!, AP_LATITUDE) || !inside(value.longitude!, AP_LONGITUDE)) {
      return OUTSIDE_AP;
    }
    return '';
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    const problem = this.problem();
    if (problem) {
      this.form.markAllAsTouched();
      this.error.set(problem);
      return;
    }
    const value = this.form.getRawValue();
    const payload: PumpPayload = {
      name: value.name.trim(),
      kind: value.kind,
      address: value.address.trim(),
      district: value.district!,
      latitude: roundCoordinate(value.latitude!),
      longitude: roundCoordinate(value.longitude!),
      opening_hours: value.opening_hours.trim() || DEFAULT_HOURS,
      sells_petrol: value.sells_petrol,
      sells_diesel: value.sells_diesel,
    };
    this.error.set('');
    this.saving.set(true);
    const existing = this.pump();
    const call =
      existing === null ? this.api.create(payload) : this.api.update(existing.id, payload);
    call.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err));
        this.saving.set(false);
      },
    });
  }
}
