import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, InjectionToken, Service } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { catchError, from, map, Observable, switchMap, throwError } from 'rxjs';
import { DeviceToken } from './device-token';
import { API_BASE, NATIVE_APP } from './native';

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

/** How the phone apps fetch a file and hand it on: their WebView cannot save a file itself. */
export interface PhoneFiles {
  /** Fetches the file, keeps it on the phone and opens the share sheet (Files, mail, chat); resolves with its name. */
  fetchAndShare(
    url: string,
    params: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<string>;
}

/** A header of a native answer, whatever its case. */
function header(headers: Record<string, string>, name: string): string | null {
  const key = Object.keys(headers).find((each) => each.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : headers[key];
}

/** What the server said when it refused: a native binary answer comes as Base64. */
function refusal(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(atob(data));
  } catch {
    return data;
  }
}

const capacitorFiles: PhoneFiles = {
  async fetchAndShare(url, params, headers) {
    const answer = await CapacitorHttp.get({ url, params, headers, responseType: 'blob' });
    if (answer.status >= 400) {
      throw new HttpErrorResponse({ error: refusal(answer.data), status: answer.status, url });
    }
    const name = fileName(header(answer.headers, 'Content-Disposition'));
    const file = await Filesystem.writeFile({
      path: name,
      data: answer.data,
      directory: Directory.Cache,
    });
    await Share.share({ title: name, files: [file.uri] }).catch(() => undefined); // closing the sheet is fine
    return name;
  },
};

export const PHONE_FILES = new InjectionToken<PhoneFiles>('PHONE_FILES', {
  providedIn: 'root',
  factory: () => capacitorFiles,
});

/**
 * Saves a file the server makes (an Excel statement, a list) under the name the server gives it: the browser saves
 * it; the phone apps keep it on the phone and offer to share it.
 */
@Service()
export class Downloads {
  private readonly http = inject(HttpClient);
  private readonly native = inject(NATIVE_APP);
  private readonly base = inject(API_BASE);
  private readonly deviceToken = inject(DeviceToken);
  private readonly phoneFiles = inject(PHONE_FILES);

  /** Asks for `url` with `params` and saves what comes back. Emits the file's name once it is saved. */
  save(url: string, params: DownloadParams = {}): Observable<string> {
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        filters[key] = String(value);
      }
    }
    if (this.native) {
      const token = this.deviceToken.current();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      return from(this.phoneFiles.fetchAndShare(this.base + url, filters, headers));
    }
    const query = new HttpParams({ fromObject: filters });
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
