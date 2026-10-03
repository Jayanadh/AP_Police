import { Component, inject, signal } from '@angular/core';
import { MissingReading, OdometerApi, OdometerReading } from '../../core/api/odometer-api';
import { Vehicle, VehiclesApi } from '../../core/api/vehicles-api';
import { formatDate, km } from '../../core/format';
import { Panel } from '../../core/panel';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';

/** The Sunday odometer readings: which vehicles have not given this week's, and the readings of any one vehicle. */
@Component({
  selector: 'app-odometer-page',
  imports: [EmptyState, LoadError, PageHeader],
  templateUrl: './odometer-page.html',
  styles: `
    .cards {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;

      @media (min-width: 1100px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }

      > * {
        min-width: 0;
      }
    }

    h2 {
      margin-bottom: 16px;
      font-size: 19px;
    }

    .missing-row {
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 14px;
      overflow-wrap: anywhere;
    }

    .who {
      display: flex;
      flex-direction: column;
    }

    .registration {
      font-weight: 700;
    }

    .vehicle-field {
      max-width: 320px;
      margin-bottom: 16px;
    }

    // Tight cells, and headings that may wrap, so the three columns fit a 360 px phone.
    .table th,
    .table td {
      padding-inline: 10px;
    }

    .table th {
      white-space: normal;
    }
  `,
})
export class OdometerPage {
  private readonly odometer = inject(OdometerApi);
  private readonly vehicleApi = inject(VehiclesApi);

  protected readonly formatDate = formatDate;
  protected readonly km = km;

  /** The id of the vehicle chosen in the select, or null before one is chosen. */
  protected readonly vehicleId = signal<number | null>(null);

  protected readonly missing = new Panel<MissingReading[]>(() => this.odometer.missing());
  protected readonly vehicles = new Panel<Vehicle[]>(() => this.vehicleApi.list());
  protected readonly readings = new Panel<OdometerReading[]>(() =>
    this.odometer.list(this.vehicleId() ?? undefined),
  );

  constructor() {
    this.missing.load();
    this.vehicles.load();
  }

  protected choose(value: string): void {
    if (!value) {
      this.vehicleId.set(null);
      this.readings.reset();
      return;
    }
    this.vehicleId.set(Number(value));
    this.readings.load();
  }
}
