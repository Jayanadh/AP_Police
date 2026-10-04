import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { NumberField } from './number-field';

@Component({
  imports: [NumberField, ReactiveFormsModule],
  template: `
    <input id="litres" type="text" appNumber="2" [formControl]="litres" />
    <input id="km" type="text" appNumber [formControl]="km" />
  `,
})
class Form {
  readonly litres = new FormControl<number | null>(null);
  readonly km = new FormControl<number | null>(12480);
}

describe('NumberField', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Form);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const form = fixture.componentInstance;
    const type = (id: string, text: string) => {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      return input;
    };
    return { fixture, el, form, type };
  }

  it('is a text box, so scrolling over it or pressing the arrow keys never changes it', async () => {
    const { el } = await setup();
    const litres = el.querySelector<HTMLInputElement>('#litres')!;
    expect(litres.type).toBe('text');
    expect(litres.getAttribute('inputmode')).toBe('decimal');
    expect(el.querySelector('#km')!.getAttribute('inputmode')).toBe('numeric');
  });

  it('gives the form a number, with up to the decimals allowed', async () => {
    const { form, type } = await setup();

    expect(type('litres', '12.345').value).toBe('12.34');
    expect(form.litres.value).toBe(12.34);

    expect(type('litres', '7.').value).toBe('7.');
    expect(form.litres.value).toBe(7);
  });

  it('takes no minus sign, letters or a second point', async () => {
    const { form, type } = await setup();

    expect(type('litres', '-5').value).toBe('5');
    expect(type('litres', '1.2.3').value).toBe('1.2'); // a second point ends the number
    expect(type('litres', 'abc').value).toBe('');
    expect(form.litres.value).toBeNull();
  });

  it('takes whole numbers only when no decimals are allowed, stopping at a point', async () => {
    const { form, type } = await setup();
    // Not 124805: a pasted reading must not grow ten times over.
    expect(type('km', '12,480.5').value).toBe('12480');
    expect(form.km.value).toBe(12480);
  });

  it('shows the value the form sets, and nothing for none', async () => {
    const { fixture, el, form } = await setup();
    expect(el.querySelector<HTMLInputElement>('#km')!.value).toBe('12480');

    form.km.setValue(null);
    form.litres.setValue(20.5);
    await fixture.whenStable();

    expect(el.querySelector<HTMLInputElement>('#km')!.value).toBe('');
    expect(el.querySelector<HTMLInputElement>('#litres')!.value).toBe('20.5');
  });

  it('marks the control touched when the box is left', async () => {
    const { el, form } = await setup();
    el.querySelector('#litres')!.dispatchEvent(new Event('blur'));
    expect(form.litres.touched).toBe(true);
  });

  it('follows the form when it is disabled', async () => {
    const { fixture, el, form } = await setup();
    form.litres.disable();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#litres')!.disabled).toBe(true);
  });
});
