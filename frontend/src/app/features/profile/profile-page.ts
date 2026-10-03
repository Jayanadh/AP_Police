import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore, ROLE_LABELS } from '../../core/auth-store';
import { Icon } from '../../ui/icon';
import { PageHeader } from '../../ui/page-header';

@Component({
  selector: 'app-profile-page',
  imports: [Icon, PageHeader, RouterLink],
  templateUrl: './profile-page.html',
  styles: `
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 20px;
    }

    .list-row {
      justify-content: space-between;
      gap: 16px;
    }

    .value {
      min-width: 0;
      text-align: right;
      overflow-wrap: anywhere;
    }
  `,
})
export class ProfilePage {
  private readonly auth = inject(AuthStore);

  protected readonly user = this.auth.user;
  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  /** The details worth showing, in order; empty ones are left out. */
  protected readonly rows = computed(() => {
    const user = this.user();
    if (!user) {
      return [];
    }
    return [
      { label: 'Name', value: user.full_name },
      { label: 'Emp ID', value: user.emp_id },
      { label: 'Designation', value: user.designation_name },
      { label: 'District', value: user.district_name },
      { label: 'Cadre', value: user.cadre_name },
      { label: 'MTO office', value: user.unit_name },
      { label: 'Pump', value: user.pump_name },
      { label: 'Mobile', value: user.mobile },
    ].filter((row) => !!row.value);
  });
}
