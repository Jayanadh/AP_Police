import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DirectoryPump, PumpsApi, pumpToPoint, pumpWhere } from '../../core/api/pumps-api';
import { FuelType, fuelLabel, MyVehicles, VehiclesApi } from '../../core/api/vehicles-api';
import { distanceKm, formatDistance, GeoService, LatLng } from '../../core/geo';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { FuelFlowScene } from '../../ui/fuel-flow-scene';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { StatCard } from '../../ui/stat-card';

/** A fuel the pump sells, and whether a police pump has it in stock (a tie-up bunk keeps no stock). */
type FuelChip = { value: FuelType; label: string; inStock: boolean };

function sells(pump: DirectoryPump, fuel: FuelType): boolean {
  return fuel === 'PETROL' ? pump.sells_petrol : pump.sells_diesel;
}

/** Whether the pump can fill the fuel now: a bunk that sells it, a police pump that has it in stock. */
function canFill(pump: DirectoryPump, fuel: FuelType): boolean {
  return fuel === 'PETROL' ? pump.petrol_available : pump.diesel_available;
}

/**
 * One pump, like the reference app's station screen: where it is, the way there, its fuels, and Fill Up when it can
 * fill the driver's vehicle now.
 */
@Component({
  selector: 'app-driver-pump-detail-page',
  imports: [EmptyState, FuelFlowScene, Icon, LoadError, RouterLink, StatCard],
  templateUrl: './pump-detail-page.html',
  styleUrl: './pump-detail-page.scss',
})
export class PumpDetailPage {
  /** The pump's id, from the route. */
  readonly id = input.required<string>();

  private readonly pumpsApi = inject(PumpsApi);
  private readonly vehiclesApi = inject(VehiclesApi);
  private readonly geo = inject(GeoService);

  protected readonly fuelLabel = fuelLabel;
  protected readonly pumpWhere = pumpWhere;

  protected readonly directory = new Panel<DirectoryPump[]>(() => this.pumpsApi.directory());
  protected readonly mine = new Panel<MyVehicles>(() => this.vehiclesApi.myVehicles());
  private readonly here = signal<LatLng | null>(null);

  protected readonly pump = computed(
    () => this.directory.data()?.find((pump) => pump.id === Number(this.id())) ?? null,
  );
  protected readonly vehicle = computed(() => this.mine.data()?.vehicles[0] ?? null);
  /** Known to have no vehicle (not merely still loading, or failed to load). */
  protected readonly noVehicle = computed(() => this.mine.data() !== null && !this.vehicle());

  protected readonly distance = computed(() => {
    const pump = this.pump();
    const here = this.here();
    return formatDistance(pump && here ? distanceKm(here, pumpToPoint(pump)) : null);
  });

  protected readonly directions = computed(() => {
    const pump = this.pump();
    if (!pump) {
      return '';
    }
    const { lat, lng } = pumpToPoint(pump);
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  });

  /** The fuels the pump sells. */
  protected readonly fuels = computed<FuelChip[]>(() => {
    const pump = this.pump();
    if (!pump) {
      return [];
    }
    return (['PETROL', 'DIESEL'] as const)
      .filter((value) => sells(pump, value))
      .map((value) => ({ value, label: fuelLabel(value), inStock: canFill(pump, value) }));
  });

  /** Why this pump cannot fill the driver's vehicle now, or '' when it can. */
  protected readonly cannotFill = computed(() => {
    const pump = this.pump();
    const vehicle = this.vehicle();
    if (!pump || !vehicle || canFill(pump, vehicle.fuel_type)) {
      return '';
    }
    const fuel = fuelLabel(vehicle.fuel_type).toLowerCase();
    return sells(pump, vehicle.fuel_type)
      ? `${pump.name} has no ${fuel} in stock now.`
      : `${pump.name} does not sell ${fuel}.`;
  });

  constructor() {
    this.directory.load();
    this.mine.load();
    void this.geo.current().then((position) => this.here.set(position));
  }
}
