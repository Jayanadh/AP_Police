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
import {
  FUEL_TYPES,
  FuelType,
  Vehicle,
  VEHICLE_TYPES,
  VehiclePayload,
  VehiclesApi,
  VehicleType,
} from '../../core/api/vehicles-api';

const INCOMPLETE =
  'Fill in the registration number, type, make, model, fuel type, tank capacity and monthly fuel limit.';

/** Adds a vehicle, or changes one. The page decides what happens after it is saved. */
@Component({
  selector: 'app-vehicle-form',
  imports: [ReactiveFormsModule],
  templateUrl: './vehicle-form.html',
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

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
})
export class VehicleForm {
  private readonly api = inject(VehiclesApi);
  private readonly fb = inject(NonNullableFormBuilder);

  /** The vehicle to change; leave empty to add a new one. */
  readonly vehicle = input<Vehicle | null>(null);
  readonly saved = output<Vehicle>();
  readonly cancelled = output<void>();

  private readonly registrationField = viewChild<ElementRef<HTMLInputElement>>('registrationField');

  protected readonly types = VEHICLE_TYPES;
  protected readonly fuels = FUEL_TYPES;
  protected readonly adding = computed(() => this.vehicle() === null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.group({
    registration_number: ['', Validators.required],
    vehicle_type: [null as VehicleType | null, Validators.required],
    make: ['', Validators.required],
    model: ['', Validators.required],
    year_of_manufacture: [null as number | null],
    fuel_type: [null as FuelType | null, Validators.required],
    tank_capacity_litres: [null as number | null, Validators.required],
    chassis_number: [''],
    engine_number: [''],
    odometer_at_onboarding_km: [null as number | null],
    monthly_fuel_limit_litres: [null as number | null, Validators.required],
    service_interval_km: [null as number | null],
    service_interval_days: [null as number | null],
  });

  constructor() {
    effect(() => {
      const vehicle = this.vehicle();
      untracked(() => this.fillFrom(vehicle));
    });
    // The first field is ready for typing whenever the form appears or another vehicle is chosen.
    effect(() => {
      this.vehicle();
      this.registrationField()?.nativeElement.focus();
    });
  }

  private fillFrom(vehicle: Vehicle | null): void {
    this.error.set('');
    if (vehicle === null) {
      this.form.reset();
      return;
    }
    this.form.reset({
      registration_number: vehicle.registration_number,
      vehicle_type: vehicle.vehicle_type,
      make: vehicle.make,
      model: vehicle.model,
      year_of_manufacture: vehicle.year_of_manufacture,
      fuel_type: vehicle.fuel_type,
      tank_capacity_litres: Number(vehicle.tank_capacity_litres),
      chassis_number: vehicle.chassis_number,
      engine_number: vehicle.engine_number,
      odometer_at_onboarding_km: vehicle.odometer_at_onboarding_km,
      monthly_fuel_limit_litres: Number(vehicle.monthly_fuel_limit_litres),
      service_interval_km: vehicle.service_interval_km,
      service_interval_days: vehicle.service_interval_days,
    });
  }

  /** Registration numbers are capitals; the box shows them that way as they are typed. */
  protected upperCase(event: Event): void {
    const input = event.target as HTMLInputElement;
    const upper = input.value.toUpperCase();
    if (upper !== input.value) {
      const { selectionStart, selectionEnd } = input;
      input.value = upper;
      input.setSelectionRange(selectionStart, selectionEnd);
    }
    this.form.controls.registration_number.setValue(upper);
  }

  protected chooseFuel(fuel: FuelType): void {
    this.form.controls.fuel_type.setValue(fuel);
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INCOMPLETE);
      return;
    }
    const value = this.form.getRawValue();
    const payload: VehiclePayload = {
      registration_number: value.registration_number.trim().toUpperCase(),
      vehicle_type: value.vehicle_type!,
      make: value.make.trim(),
      model: value.model.trim(),
      year_of_manufacture: value.year_of_manufacture,
      fuel_type: value.fuel_type!,
      tank_capacity_litres: value.tank_capacity_litres!,
      chassis_number: value.chassis_number.trim(),
      engine_number: value.engine_number.trim(),
      odometer_at_onboarding_km: value.odometer_at_onboarding_km ?? 0,
      monthly_fuel_limit_litres: value.monthly_fuel_limit_litres!,
      service_interval_km: value.service_interval_km,
      service_interval_days: value.service_interval_days,
    };
    this.error.set('');
    this.saving.set(true);
    const existing = this.vehicle();
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
