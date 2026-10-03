import { Component, computed, inject, signal } from '@angular/core';
import { FuelRequest, FuelRequestsApi } from '../../core/api/fuel-requests-api';
import {
  FUEL_STATEMENT_EXPORT,
  FuelStatement,
  FuelStatementApi,
} from '../../core/api/fuel-statement-api';
import { FuelType, Vehicle, VehiclesApi } from '../../core/api/vehicles-api';
import { AuthStore, Role } from '../../core/auth-store';
import { NOW } from '../../core/clock';
import { formatDateTime, litres } from '../../core/format';
import { Panel } from '../../core/panel';
import { Period, periodOf, todayIso } from '../../core/period';
import { DownloadButton } from '../../ui/download-button';
import { EmptyState } from '../../ui/empty-state';
import { LoadError } from '../../ui/load-error';
import { OfficeSelect } from '../../ui/office-select';
import { PageHeader } from '../../ui/page-header';
import { PeriodPicker } from '../../ui/period-picker';
import { StatCard } from '../../ui/stat-card';

const MINUS = '−';

const FUEL_LABELS: Record<FuelType, string> = { PETROL: 'Petrol', DIESEL: 'Diesel' };
const PUMP_KIND_LABELS: Record<'POLICE' | 'TIE_UP', string> = {
  POLICE: 'Police pump',
  TIE_UP: 'Tie-up bunk',
};

const SUBTITLES: Record<Role, string> = {
  PTO: 'What every office’s vehicles filled, for a day, a week, a month, a year or any dates.',
  MTO: 'What your office’s vehicles filled, and the duty particulars drivers owe for it.',
  OFFICER: 'What your vehicles filled, and the duty particulars drivers owe for it.',
  DRIVER: 'What you filled, for a day, a week, a month, a year or any dates.',
  PUMP_OPERATOR: 'What was filled at your pump.',
};

/**
 * The fuel statement of any period, for every role: totals, then per office (PTO), per vehicle, per pump and, at a
 * police pump, each tank's stock, then the fills themselves. The PTO sees vehicles and fills once an office is
 * picked; the MTO can narrow the fills to one vehicle.
 */
@Component({
  selector: 'app-fuel-statement-page',
  imports: [
    DownloadButton,
    EmptyState,
    LoadError,
    OfficeSelect,
    PageHeader,
    PeriodPicker,
    StatCard,
  ],
  templateUrl: './fuel-statement-page.html',
  styleUrl: './fuel-statement-page.scss',
})
export class FuelStatementPage {
  private readonly auth = inject(AuthStore);
  private readonly statements = inject(FuelStatementApi);
  private readonly requests = inject(FuelRequestsApi);
  private readonly vehiclesApi = inject(VehiclesApi);

  protected readonly litres = litres;
  protected readonly formatDateTime = formatDateTime;
  protected readonly exportUrl = FUEL_STATEMENT_EXPORT;

  protected readonly isPto = computed(() => this.auth.role() === 'PTO');
  protected readonly isMto = computed(() => this.auth.role() === 'MTO');
  protected readonly atPump = computed(() => this.auth.role() === 'PUMP_OPERATOR');
  protected readonly subtitle = computed(() => {
    const user = this.auth.user();
    if (user?.role === 'PUMP_OPERATOR' && user.pump_kind === 'POLICE') {
      return 'What was filled at your pump, and how its stock moved.';
    }
    return user ? SUBTITLES[user.role] : '';
  });

  protected readonly period = signal<Period>(periodOf('month', todayIso(inject(NOW)())));
  /** The PTO's chosen office, or null for all of them. */
  protected readonly unitId = signal<number | null>(null);
  /** The MTO's chosen vehicle for the fills, or null for all. */
  protected readonly vehicleId = signal<number | null>(null);

  protected readonly vehicles = new Panel<Vehicle[]>(() => this.vehiclesApi.list());
  protected readonly summary = new Panel<FuelStatement>(() =>
    this.statements.get(this.period(), this.unitId() ?? undefined),
  );
  protected readonly fills = new Panel<FuelRequest[]>(() => {
    const { from, to } = this.period();
    if (this.atPump()) {
      return this.requests.pumpFills({ from, to });
    }
    return this.requests.list({
      from,
      to,
      status: 'FILLED',
      unit: this.unitId() ?? undefined,
      vehicle: this.vehicleId() ?? undefined,
    });
  });

  /** The Excel file of the statement on screen: its period and, for the PTO, its office. */
  protected readonly downloadParams = computed(() => ({
    from: this.period().from,
    to: this.period().to,
    unit: this.unitId(),
  }));
  /** The whole state's fills would be thousands of rows: the PTO picks an office first. */
  protected readonly showFills = computed(() => !this.isPto() || this.unitId() !== null);
  protected readonly overdueText = computed(() => {
    const count = (this.fills.data() ?? []).filter((fill) => fill.duty_overdue).length;
    if (count === 0) {
      return '';
    }
    return count === 1
      ? '1 fill is past 48 hours without duty particulars.'
      : `${count} fills are past 48 hours without duty particulars.`;
  });

  constructor() {
    if (this.isMto()) {
      this.vehicles.load();
    }
    this.summary.load();
    this.loadFills();
  }

  protected choosePeriod(period: Period): void {
    this.period.set(period);
    this.summary.load();
    this.loadFills();
  }

  protected chooseUnit(unit: number | undefined): void {
    this.unitId.set(unit ?? null);
    this.summary.load();
    this.loadFills();
  }

  protected chooseVehicle(value: string): void {
    this.vehicleId.set(value ? Number(value) : null);
    this.fills.load();
  }

  private loadFills(): void {
    if (this.showFills()) {
      this.fills.load();
    } else {
      this.fills.reset();
    }
  }

  protected fuelLabel(fuel: FuelType): string {
    return FUEL_LABELS[fuel];
  }

  protected pumpKindLabel(kind: 'POLICE' | 'TIE_UP'): string {
    return PUMP_KIND_LABELS[kind];
  }

  /** Litres, or a dash for none, so the figures that matter stand out in a table. */
  protected orDash(value: string): string {
    return Number(value) === 0 ? '—' : litres(value);
  }

  /** Litres with a sign: what came in (+) or went out (−). */
  protected signed(value: string | number, direction: 1 | -1 = 1): string {
    const amount = Number(value) * direction;
    if (amount > 0) {
      return `+${litres(amount)}`;
    }
    if (amount < 0) {
      return `${MINUS}${litres(-amount)}`;
    }
    return litres(0);
  }

  protected isEmergency(fill: FuelRequest): boolean {
    return fill.emergency_status !== 'NONE';
  }

  protected hasDuty(fill: FuelRequest): boolean {
    return fill.duty_submitted_at !== null;
  }

  protected tone(value: string): 'warning' | 'default' {
    return Number(value) > 0 ? 'warning' : 'default';
  }
}
