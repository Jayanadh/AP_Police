import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE, apiAddressInterceptor } from './native';

describe('apiAddressInterceptor', () => {
  function setup(base: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiAddressInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE, useValue: base },
      ],
    });
    return { http: TestBed.inject(HttpClient), backend: TestBed.inject(HttpTestingController) };
  }

  it('sends API calls to the server in the phone apps', () => {
    const { http, backend } = setup('https://mto.example.gov.in');
    http.get('/api/auth/session/').subscribe();
    backend.expectOne('https://mto.example.gov.in/api/auth/session/').flush({});
    backend.verify();
  });

  it('leaves everything else alone, and every call alone in the web app', () => {
    const { http, backend } = setup('https://mto.example.gov.in');
    http.get('/logos/ap-police.webp').subscribe();
    backend.expectOne('/logos/ap-police.webp').flush('');
    TestBed.resetTestingModule();

    const web = setup('');
    web.http.get('/api/auth/session/').subscribe();
    web.backend.expectOne('/api/auth/session/').flush({});
    web.backend.verify();
  });
});
