import { afterNextRender, Component, inject, Injector, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MasterItem, MastersApi } from '../../core/api/masters-api';
import { Unit, UnitsApi } from '../../core/api/units-api';
import { apiErrorMessage } from '../../core/api-error';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { LoadError } from '../../ui/load-error';
import { PageHeader } from '../../ui/page-header';
import { ToastService } from '../../ui/toast';

const ADD_INCOMPLETE = 'Fill in the office details and the MTO login details.';
const HANDOVER_INCOMPLETE = 'Fill in the new holder details and a new password.';

@Component({
  selector: 'app-units-page',
  imports: [EmptyState, Icon, LoadError, PageHeader, ReactiveFormsModule],
  templateUrl: './units-page.html',
  styles: `
    h2 {
      font-size: 18px;
    }

    h3 {
      margin-bottom: 12px;
      font-size: 16px;
    }

    .form-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .add-card {
      margin-bottom: 20px;
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .hint {
      font-size: 13px;
    }

    .office-head {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
    }

    .office-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary) 22%, white);
      color: var(--primary-strong);
    }

    .office-title {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .office-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .holder {
      margin: 0;
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);

      > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 4px 0;
      }

      dt {
        color: var(--muted);
      }

      dd {
        margin: 0;
        font-weight: 600;
        text-align: right;
        overflow-wrap: anywhere;
      }
    }

    .handover {
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class UnitsPage {
  private readonly unitsApi = inject(UnitsApi);
  private readonly mastersApi = inject(MastersApi);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly units = signal<Unit[]>([]);
  protected readonly districts = signal<MasterItem[]>([]);
  protected readonly designations = signal<MasterItem[]>([]);
  protected readonly cadres = signal<MasterItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');

  protected readonly showAdd = signal(false);
  protected readonly adding = signal(false);
  protected readonly addError = signal('');
  protected readonly addForm = this.fb.group({
    name: ['', Validators.required],
    code: ['', Validators.required],
    district: [null as number | null, Validators.required],
    address: [''],
    phone: [''],
    mto: this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
      full_name: ['', Validators.required],
      emp_id: ['', Validators.required],
      designation: [null as number | null, Validators.required],
      cadre: [null as number | null, Validators.required],
      mobile: [''],
    }),
  });

  /** The office whose chair is being handed over; only one form is open at a time. */
  protected readonly handoverFor = signal<number | null>(null);
  protected readonly handingOver = signal(false);
  protected readonly handoverError = signal('');
  protected readonly handoverForm = this.fb.group({
    full_name: ['', Validators.required],
    emp_id: ['', Validators.required],
    designation: [null as number | null, Validators.required],
    cadre: [null as number | null, Validators.required],
    mobile: [''],
    password: ['', Validators.required],
  });

  constructor() {
    this.load();
  }

  /** The offices and the dropdown values the forms need. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      units: this.unitsApi.list(),
      districts: this.mastersApi.list('districts'),
      designations: this.mastersApi.list('designations'),
      cadres: this.mastersApi.list('cadres'),
    }).subscribe({
      next: (loaded) => {
        this.units.set(loaded.units);
        this.districts.set(loaded.districts);
        this.designations.set(loaded.designations);
        this.cadres.set(loaded.cadres);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  /** Re-reads the offices only, so the page does not blink after a change. */
  private refresh(): void {
    this.unitsApi.list().subscribe({
      next: (units) => this.units.set(units),
      error: (err) => this.toasts.show(apiErrorMessage(err), 'danger'),
    });
  }

  protected openAdd(): void {
    this.showAdd.set(true);
    this.focusLater('unit-name');
  }

  protected cancelAdd(): void {
    this.showAdd.set(false);
    this.addError.set('');
  }

  protected create(): void {
    if (this.adding()) {
      return;
    }
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      this.addError.set(ADD_INCOMPLETE);
      return;
    }
    const value = this.addForm.getRawValue();
    const { mto } = value;
    this.addError.set('');
    this.adding.set(true);
    this.unitsApi
      .create({
        name: value.name.trim(),
        code: value.code.trim(),
        district: value.district!,
        address: value.address.trim(),
        phone: value.phone.trim(),
        mto_account: {
          username: mto.username.trim(),
          password: mto.password,
          full_name: mto.full_name.trim(),
          emp_id: mto.emp_id.trim(),
          designation: mto.designation!,
          cadre: mto.cadre!,
          mobile: mto.mobile.trim(),
        },
      })
      .subscribe({
        next: () => {
          this.toasts.show('MTO office added.');
          this.addForm.reset();
          this.showAdd.set(false);
          this.adding.set(false);
          this.refresh();
        },
        error: (err) => {
          this.addError.set(apiErrorMessage(err));
          this.adding.set(false);
        },
      });
  }

  protected openHandover(unit: Unit): void {
    this.handoverForm.reset();
    this.handoverError.set('');
    this.handoverFor.set(unit.id);
    this.focusLater('ho-name');
  }

  protected cancelHandover(): void {
    this.handoverFor.set(null);
    this.handoverError.set('');
  }

  protected handover(unit: Unit): void {
    if (this.handingOver()) {
      return;
    }
    if (this.handoverForm.invalid) {
      this.handoverForm.markAllAsTouched();
      this.handoverError.set(HANDOVER_INCOMPLETE);
      return;
    }
    const value = this.handoverForm.getRawValue();
    this.handoverError.set('');
    this.handingOver.set(true);
    this.unitsApi
      .handover(unit.id, {
        full_name: value.full_name.trim(),
        emp_id: value.emp_id.trim(),
        designation: value.designation!,
        cadre: value.cadre!,
        mobile: value.mobile.trim(),
        password: value.password,
      })
      .subscribe({
        next: () => {
          this.toasts.show(`MTO chair handed over to ${value.full_name.trim()}.`);
          this.handoverFor.set(null);
          this.handingOver.set(false);
          this.refresh();
        },
        error: (err) => {
          this.handoverError.set(apiErrorMessage(err));
          this.handingOver.set(false);
        },
      });
  }

  /** Moves the keyboard to the first field of a form that has just appeared. */
  private focusLater(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
