import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { PumpKind, Role } from '../auth-store';

// Shapes of GET /api/dashboard/, one per role (see backend/dashboards/summaries.py).
// Litres are two-decimal strings such as "12.50"; moments are ISO 8601 strings.

type DashboardBase<R extends Role> = {
  role: R;
  /** The calendar month the figures are for, "YYYY-MM". */
  month: string;
};

/** One MTO office in the PTO's side-by-side summary. */
export type PtoUnitSummary = {
  id: number;
  name: string;
  code: string;
  vehicles_active: number;
  vehicles_paused: number;
  fuel_used_litres: string;
  fuel_limit_litres: string;
  low_stock_tanks: number;
  pending_emergencies: number;
};

export type PtoDashboard = DashboardBase<'PTO'> & {
  units: PtoUnitSummary[];
  pending_approvals: number;
  totals: {
    vehicles_active: number;
    fuel_used_litres: string;
    fuel_limit_litres: string;
    low_stock_tanks: number;
  };
};

/** A police pump's tank with its stock; `is_low` is true below the low-stock threshold. */
export type DashboardTank = {
  id: number;
  pump_name: string;
  fuel_type: 'PETROL' | 'DIESEL';
  current_stock_litres: string;
  low_stock_threshold_litres: string;
  /** Null until the MTO sets the tank's size. */
  capacity_litres: string | null;
  is_low: boolean;
};

export type MtoDashboard = DashboardBase<'MTO'> & {
  vehicles: { active: number; paused: number; termination_pending: number };
  fuel: { used_litres: string; limit_litres: string };
  top_vehicles: {
    id: number;
    registration_number: string;
    used_litres: string;
    limit_litres: string;
  }[];
  tanks: DashboardTank[];
  pending_emergencies: number;
  overdue_duty: number;
  missing_odometer: number;
  services_due: number;
  transfers_to_decide: number;
};

export type OfficerDashboard = DashboardBase<'OFFICER'> & {
  vehicles: {
    id: number;
    registration_number: string;
    make: string;
    model: string;
    driver_name: string | null;
    limit_litres: string;
    used_litres: string;
    remaining_litres: string;
  }[];
  recent_fills: {
    id: number;
    registration_number: string;
    litres_filled: string;
    filled_at: string;
    pump_name: string;
    duty_particulars: string;
  }[];
};

export type DriverDashboard = DashboardBase<'DRIVER'> & {
  /** Null when the driver is not on a vehicle. */
  vehicle: {
    id: number;
    registration_number: string;
    make: string;
    model: string;
    fuel_type: 'PETROL' | 'DIESEL';
  } | null;
  quota: {
    limit_litres: string;
    used_litres: string;
    remaining_litres: string;
    emergency_remaining_litres: string;
  } | null;
  /** The request whose PIN is still valid, if any. */
  open_request: {
    id: number;
    pin: string;
    litres_requested: string;
    expires_at: string;
  } | null;
  duty_due: {
    id: number;
    registration_number: string;
    filled_at: string;
    litres_filled: string;
    duty_due_at: string;
    duty_overdue: boolean;
  }[];
  odometer: {
    /** The Sunday the reading is for, "YYYY-MM-DD". */
    week_of: string;
    recorded: boolean;
    reading_km: number | null;
  };
};

export type PumpDashboard = DashboardBase<'PUMP_OPERATOR'> & {
  pump: { id: number; name: string; kind: PumpKind };
  tanks: DashboardTank[];
  today_fills: { count: number; litres: string };
  /** How many drivers' requests wait at this pump to be filled. */
  waiting: number;
};

/** The signed-in user's own dashboard. Pick the type that matches the role: `get<PtoDashboard>()`. */
@Service()
export class DashboardApi {
  private readonly http = inject(HttpClient);

  get<T>(): Observable<T> {
    return this.http.get<T>('/api/dashboard/');
  }
}
