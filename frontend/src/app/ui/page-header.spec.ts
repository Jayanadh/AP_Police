import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageHeader } from './page-header';

@Component({
  imports: [PageHeader],
  template: `
    <app-page-header title="Vehicles" subtitle="Nellore MTO" backLink="/mto/dashboard">
      <button class="btn btn-primary">Add vehicle</button>
    </app-page-header>
    <app-page-header title="Home" />
  `,
})
class Host {}

describe('PageHeader', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('shows the title, subtitle, back link and projected actions', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const [full] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-page-header'),
    );
    expect(full.querySelector('h1')?.textContent?.trim()).toBe('Vehicles');
    expect(full.querySelector('p')?.textContent?.trim()).toBe('Nellore MTO');
    expect(full.querySelector('a')?.getAttribute('href')).toBe('/mto/dashboard');
    expect(full.querySelector('button')?.textContent?.trim()).toBe('Add vehicle');
  });

  it('leaves out the back link and subtitle when not given', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const bare = (fixture.nativeElement as HTMLElement).querySelectorAll('app-page-header')[1];
    expect(bare.querySelector('h1')?.textContent?.trim()).toBe('Home');
    expect(bare.querySelector('a')).toBeNull();
    expect(bare.querySelector('p')).toBeNull();
  });
});
