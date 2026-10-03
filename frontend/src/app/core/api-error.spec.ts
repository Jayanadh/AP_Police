import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from './api-error';

function httpError(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error });
}

describe('apiErrorMessage', () => {
  it('returns the detail string of a business-rule refusal', () => {
    const err = httpError(400, { detail: 'This vehicle already has a request open.' });
    expect(apiErrorMessage(err)).toBe('This vehicle already has a request open.');
  });

  it('returns the first field error with a readable field name', () => {
    const err = httpError(400, { emp_id: ['This field is required.'] });
    expect(apiErrorMessage(err)).toBe('emp id: This field is required.');
  });

  it('reads the first nested field error', () => {
    const err = httpError(400, { vehicle: { registration: ['Enter a valid registration.'] } });
    expect(apiErrorMessage(err)).toBe('registration: Enter a valid registration.');
  });

  it('reads field errors inside lists of objects', () => {
    const err = httpError(400, { rows: [{}, { litres: ['Must be positive.'] }] });
    expect(apiErrorMessage(err)).toBe('litres: Must be positive.');
  });

  it('shows non-field errors without a field name', () => {
    const err = httpError(400, { non_field_errors: ['Passwords do not match.'] });
    expect(apiErrorMessage(err)).toBe('Passwords do not match.');
  });

  it('reports an unreachable server for status 0', () => {
    const err = httpError(0, new ProgressEvent('error'));
    expect(apiErrorMessage(err)).toBe('Cannot reach the server. Check your connection.');
  });

  it('ignores an HTML body such as a proxy or server error page', () => {
    const err = httpError(502, '<html><body><h1>Bad Gateway</h1></body></html>');
    expect(apiErrorMessage(err)).toBe('Something went wrong. Please try again.');
  });

  it('falls back for unknown shapes', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    expect(apiErrorMessage(null)).toBe('Something went wrong. Please try again.');
    expect(apiErrorMessage(httpError(500, null))).toBe('Something went wrong. Please try again.');
  });
});
