import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DownloadParams } from '../core/downloads';
import { DownloadButton } from './download-button';
import { ToastService } from './toast';

@Component({
  imports: [DownloadButton],
  template: `<app-download-button url="/api/fuel/statement/export/" [params]="params()" />`,
})
class Host {
  readonly params = signal<DownloadParams>({ from: '2026-09-01', to: '2026-09-30' });
}

describe('DownloadButton', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { fixture, button };
  }

  it('downloads the Excel file for the filters the page shows now', async () => {
    const { fixture, button } = await setup();
    expect(button.textContent?.trim()).toBe('Download Excel');
    fixture.componentInstance.params.set({ from: '2026-10-01', to: '2026-10-03' });
    await fixture.whenStable();

    button.click();
    await fixture.whenStable();

    expect(button.disabled).toBe(true);
    expect(button.textContent?.trim()).toBe('Preparing…');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/fuel/statement/export/?from=2026-10-01&to=2026-10-03')
      .flush(new Blob(['xlsx']));
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Download Excel');
  });

  it('says why when the file cannot be made', async () => {
    const { fixture, button } = await setup();
    const shown: string[] = [];
    vi.spyOn(TestBed.inject(ToastService), 'show').mockImplementation((text: string) => {
      shown.push(text);
    });

    button.click();
    TestBed.inject(HttpTestingController)
      .expectOne(() => true)
      .flush(new Blob([JSON.stringify({ detail: 'Pick a bunk.' })]), {
        status: 400,
        statusText: 'Bad Request',
      });
    await vi.waitFor(() => expect(shown).toEqual(['Pick a bunk.']));
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
  });
});
