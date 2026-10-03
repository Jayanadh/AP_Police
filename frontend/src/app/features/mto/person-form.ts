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
import { forkJoin } from 'rxjs';
import { MasterItem, MastersApi } from '../../core/api/masters-api';
import { PeopleApi, Person, PersonPayload } from '../../core/api/people-api';
import { apiErrorMessage } from '../../core/api-error';

const ADD_INCOMPLETE =
  'Fill in the name, Emp ID, designation, district, cadre and a first password.';
const EDIT_INCOMPLETE = 'Fill in the name, Emp ID, designation, district and cadre.';

/** The master list values, plus the person's own value when it has since been switched off. */
function withCurrent(
  items: MasterItem[],
  id: number | null | undefined,
  name: string | undefined,
): MasterItem[] {
  if (id == null || !name || items.some((item) => item.id === id)) {
    return items;
  }
  return [...items, { id, name, is_active: false }];
}

/** Adds a driver or an officer, or changes one. The page decides what happens after it is saved. */
@Component({
  selector: 'app-person-form',
  imports: [ReactiveFormsModule],
  templateUrl: './person-form.html',
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

    .hint {
      font-size: 13px;
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .retry {
      align-self: flex-start;
    }
  `,
})
export class PersonForm {
  private readonly api = inject(PeopleApi);
  private readonly mastersApi = inject(MastersApi);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly kind = input.required<'drivers' | 'officers'>();
  /** The person to change; leave empty to add a new one. */
  readonly person = input<Person | null>(null);
  readonly saved = output<Person>();
  readonly cancelled = output<void>();

  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');

  protected readonly designations = signal<MasterItem[]>([]);
  protected readonly districts = signal<MasterItem[]>([]);
  protected readonly cadres = signal<MasterItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly adding = computed(() => this.person() === null);
  protected readonly isDriver = computed(() => this.kind() === 'drivers');
  protected readonly noun = computed(() => (this.isDriver() ? 'driver' : 'officer'));

  protected readonly designationOptions = computed(() => {
    const person = this.person();
    return withCurrent(this.designations(), person?.designation, person?.designation_name);
  });
  protected readonly districtOptions = computed(() => {
    const person = this.person();
    return withCurrent(this.districts(), person?.district, person?.district_name);
  });
  protected readonly cadreOptions = computed(() => {
    const person = this.person();
    return withCurrent(this.cadres(), person?.cadre, person?.cadre_name);
  });

  protected readonly form = this.fb.group({
    full_name: ['', Validators.required],
    emp_id: ['', Validators.required],
    designation: [null as number | null, Validators.required],
    district: [null as number | null, Validators.required],
    cadre: [null as number | null, Validators.required],
    mobile: [''],
    licence_number: [''],
    licence_valid_till: [''],
    password: ['', Validators.required],
  });

  constructor() {
    this.load();
    effect(() => {
      const person = this.person();
      untracked(() => this.fillFrom(person));
    });
    // The first field is ready for typing whenever the form appears or another person is chosen.
    effect(() => {
      this.person();
      this.nameField()?.nativeElement.focus();
    });
  }

  /** The dropdown values the form needs. */
  protected load(): void {
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      designations: this.mastersApi.list('designations'),
      districts: this.mastersApi.list('districts'),
      cadres: this.mastersApi.list('cadres'),
    }).subscribe({
      next: (loaded) => {
        this.designations.set(loaded.designations);
        this.districts.set(loaded.districts);
        this.cadres.set(loaded.cadres);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  /** A password is set when adding; changing a person never touches it (the page resets it separately). */
  private fillFrom(person: Person | null): void {
    this.error.set('');
    if (person === null) {
      this.form.reset();
      this.form.controls.password.enable();
      return;
    }
    this.form.reset({
      full_name: person.full_name,
      emp_id: person.emp_id ?? '',
      designation: person.designation,
      district: person.district,
      cadre: person.cadre,
      mobile: person.mobile,
      licence_number: person.licence_number ?? '',
      licence_valid_till: person.licence_valid_till ?? '',
      password: '',
    });
    this.form.controls.password.disable();
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    const existing = this.person();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(existing ? EDIT_INCOMPLETE : ADD_INCOMPLETE);
      return;
    }
    const value = this.form.getRawValue();
    const payload: PersonPayload = {
      full_name: value.full_name.trim(),
      emp_id: value.emp_id.trim(),
      designation: value.designation!,
      district: value.district!,
      cadre: value.cadre!,
      mobile: value.mobile.trim(),
      ...(this.isDriver() && {
        licence_number: value.licence_number.trim(),
        licence_valid_till: value.licence_valid_till || null,
      }),
      ...(existing === null && { password: value.password }),
    };
    this.error.set('');
    this.saving.set(true);
    const call =
      existing === null
        ? this.api.create(this.kind(), payload)
        : this.api.update(this.kind(), existing.id, payload);
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
