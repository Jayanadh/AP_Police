import { Directive, ElementRef, forwardRef, inject, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** `appNumber` gives the decimals allowed; `appNumber` with no value means whole numbers. */
function decimalsFrom(value: string | number | null | undefined): number {
  const decimals = Number(value);
  return Number.isInteger(decimals) && decimals > 0 ? decimals : 0;
}

/**
 * A number typed into a text box: digits and, when `appNumber` allows them, up to that many decimals. Never negative.
 * Unlike `<input type="number">` it has no arrows, and scrolling over it never changes it. The form control holds a
 * number, or null while the box is empty.
 *
 *     <input type="text" appNumber="2" formControlName="litres" />
 */
@Directive({
  selector: 'input[appNumber]',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => NumberField), multi: true },
  ],
  host: {
    autocomplete: 'off',
    '[attr.inputmode]': "decimals() > 0 ? 'decimal' : 'numeric'",
    '(input)': 'typed()',
    '(blur)': 'touched()',
  },
})
export class NumberField implements ControlValueAccessor {
  readonly decimals = input(0, { alias: 'appNumber', transform: decimalsFrom });

  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private changed: (value: number | null) => void = () => undefined;
  protected touched: () => void = () => undefined;

  writeValue(value: unknown): void {
    const number = value === null || value === undefined || value === '' ? NaN : Number(value);
    this.element.value = Number.isFinite(number) ? String(number) : '';
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.changed = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.element.disabled = disabled;
  }

  protected typed(): void {
    const text = this.element.value;
    const kept = this.clean(text);
    if (kept !== text) {
      // Put the caret back where it was, less what was taken out before it.
      const caret = Math.max(
        0,
        (this.element.selectionStart ?? text.length) - (text.length - kept.length),
      );
      this.element.value = kept;
      this.element.setSelectionRange?.(caret, caret);
    }
    this.changed(kept === '' || kept === '.' ? null : Number(kept));
  }

  /** The digits up to any second point (any point at all for whole numbers), with at most `decimals` after it. */
  private clean(text: string): string {
    const decimals = this.decimals();
    let kept = '';
    let point = false;
    let places = 0;
    for (const char of text) {
      if (char >= '0' && char <= '9') {
        if (point) {
          if (places === decimals) {
            continue;
          }
          places++;
        }
        kept += char;
      } else if (char === '.') {
        if (decimals === 0 || point) {
          break; // what follows a point is not part of a whole number, nor a second point of a decimal
        }
        point = true;
        kept += char;
      }
    }
    return kept;
  }
}
