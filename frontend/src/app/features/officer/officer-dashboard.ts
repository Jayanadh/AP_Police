import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardApi, OfficerDashboard as OfficerSummary } from '../../core/api/dashboard-api';
import { MyVehicles, VehiclesApi } from '../../core/api/vehicles-api';
import { AuthStore } from '../../core/auth-store';
import { formatDateTime, litres, monthLabel } from '../../core/format';
import { Panel } from '../../core/panel';
import { usage } from '../../core/usage';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';

/** The officer's home: the MTO to call, each of their vehicles with this month's fuel, and the latest fills. */
@Component({
  selector: 'app-officer-dashboard',
  imports: [EmptyState, Icon, LoadError, PageHeader, RouterLink],
  templateUrl: './officer-dashboard.html',
  styles: `
    .panels {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      margin-top: 16px;

      @media (min-width: 1000px) {
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        align-items: start;
      }

      > * {
        min-width: 0;
      }
    }

    h2 {
      margin-bottom: 14px;
      font-size: 19px;
    }

    .notice {
      margin-top: 16px;
    }

    .mto {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      overflow-wrap: anywhere;

      h2,
      p {
        margin: 0;
      }

      h2 {
        font-size: 13px;
        font-weight: 600;
      }
    }

    .mto-who {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .office {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .vehicles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
      gap: 16px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .vehicle {
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-wrap: anywhere;
    }

    .registration {
      display: block;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .driver {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      margin: 0;
      font-size: 14px;

      a {
        color: inherit;
        font-weight: 600;
        text-underline-offset: 3px;
      }
    }

    .figures {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 12px;
      font-size: 14px;
      font-weight: 600;
    }

    .fills {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .fill {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
      overflow-wrap: anywhere;

      &:first-child {
        padding-top: 0;
      }

      &:last-child {
        padding-bottom: 0;
        border-bottom: 0;
      }
    }

    .top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      font-weight: 700;
    }

    .fill p {
      margin: 0;
      font-size: 14px;
    }

    .more {
      margin-top: 16px;
    }
  `,
})
export class OfficerDashboard {
  private readonly api = inject(DashboardApi);
  private readonly vehicleApi = inject(VehiclesApi);
  private readonly user = inject(AuthStore).user;

  protected readonly litres = litres;
  protected readonly formatDateTime = formatDateTime;
  protected readonly usage = usage;

  protected readonly dashboard = new Panel<OfficerSummary>(() => this.api.get<OfficerSummary>());
  // The dashboard has the fuel, but the driver's phone number and the MTO to call come from here.
  protected readonly mine = new Panel<MyVehicles>(() => this.vehicleApi.myVehicles());

  protected readonly greeting = computed(() => {
    const name = this.user()?.full_name;
    return name ? `Welcome, ${name}` : 'Welcome';
  });

  protected readonly subtitle = computed(() => {
    const data = this.dashboard.data();
    return [this.user()?.unit_name, data ? monthLabel(data.month) : ''].filter(Boolean).join(' · ');
  });

  constructor() {
    this.dashboard.load();
    this.mine.load();
  }

  /** The phone number of the driver on a vehicle, if the officer's vehicles have been read and it is on file. */
  protected driverPhone(vehicleId: number): string | null {
    const vehicle = this.mine.data()?.vehicles.find((row) => row.id === vehicleId);
    return vehicle?.current_driver?.mobile || null;
  }
}
