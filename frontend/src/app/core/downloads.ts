import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { catchError, from, map, Observable, switchMap, throwError } from 'rxjs';

/** Filters sent with a download. Empty values are left out. */
export type DownloadParams = Record<string, string | number | null | undefined>;

const FALLBACK_NAME = 'download.xlsx';

/** `attachment; filename="x.xlsx"` -> `x.xlsx`. */
function fileName(disposition: string | null): string {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? FALLBACK_NAME;
}

/**
 * A refused download comes back as a Blob, not as the server's JSON. Read it, so the page can show the server's
 * own message as it does for any other call.
 */
function withReadableError(err: unknown): Observable<never> {
  if (!(err instanceof HttpErrorResponse) || !(err.error instanceof Blob)) {
    return throwError(() => err);
  }
  return from(err.error.text()).pipe(
    switchMap((text) => {
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON: keep the text
      }
      return throwError(
        () =>
          new HttpErrorResponse({
            error: body,
            headers: err.headers,
            status: err.status,
            statusText: err.statusText,
            url: err.url ?? undefined,
          }),
      );
    }),
  );
}

/** Saves a file the server makes (an Excel statement, a list) under the name the server gives it. */
@Service()
export class Downloads {
  private readonly http = inject(HttpClient);

  /** Asks for `url` with `params` and saves what comes back. Emits the file's name once it is saved. */
  save(url: string, params: DownloadParams = {}): Observable<string> {
    let query = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query = query.set(key, String(value));
      }
    }
    return this.http.get(url, { params: query, responseType: 'blob', observe: 'response' }).pipe(
      map((response) => {
        const name = fileName(response.headers.get('Content-Disposition'));
        const href = URL.createObjectURL(response.body ?? new Blob());
        const link = document.createElement('a');
        link.href = href;
        link.download = name;
        link.click();
        URL.revokeObjectURL(href);
        return name;
      }),
      catchError(withReadableError),
    );
  }
}
