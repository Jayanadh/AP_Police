import { Me, Role } from '../core/auth-store';
import { makeMe } from '../core/test-data';
import { homePathFor, NavItem, navItemsFor } from './nav';

const links = (items: NavItem[]) => items.map((item) => item.link);
const primaryLabels = (items: NavItem[]) =>
  items.filter((item) => item.primary).map((item) => item.label);

describe('navItemsFor', () => {
  it('lists the PTO items', () => {
    const items = navItemsFor(makeMe({ role: 'PTO' }));
    expect(items).toEqual([
      { label: 'Dashboard', link: '/pto', icon: 'home', primary: true },
      { label: 'MTO offices', link: '/pto/units', icon: 'building', primary: true },
      { label: 'Approvals', link: '/pto/approvals', icon: 'check-circle', primary: true },
      { label: 'Vehicles', link: '/pto/vehicles', icon: 'car', primary: true },
      { label: 'Officers', link: '/pto/officers', icon: 'shield' },
      { label: 'Drivers', link: '/pto/drivers', icon: 'user' },
      { label: 'Fuel statement', link: '/pto/statement', icon: 'droplet' },
      { label: 'Bunk statements', link: '/pto/bunk-statements', icon: 'file-text' },
      { label: 'Master lists', link: '/pto/masters', icon: 'list' },
    ]);
  });

  it('lists the MTO items', () => {
    const items = navItemsFor(makeMe({ role: 'MTO' }));
    expect(items).toEqual([
      { label: 'Dashboard', link: '/mto', icon: 'home', primary: true },
      { label: 'Vehicles', link: '/mto/vehicles', icon: 'car', primary: true },
      { label: 'Live tracking', link: '/mto/live', icon: 'map', primary: true },
      { label: 'Drivers', link: '/mto/drivers', icon: 'user' },
      { label: 'Officers', link: '/mto/officers', icon: 'shield' },
      { label: 'Transfers', link: '/mto/transfers', icon: 'arrow-left-right' },
      { label: 'Pumps', link: '/mto/pumps', icon: 'fuel' },
      { label: 'Additional quota', link: '/mto/additional-quota', icon: 'file-plus' },
      { label: 'Emergencies', link: '/mto/emergencies', icon: 'alert-triangle', primary: true },
      { label: 'Fuel statement', link: '/mto/fuel', icon: 'droplet' },
      { label: 'Bunk statements', link: '/mto/statements', icon: 'file-text' },
      { label: 'Odometer', link: '/mto/odometer', icon: 'gauge' },
      { label: 'Servicing', link: '/mto/servicing', icon: 'wrench' },
    ]);
  });

  it('lists the officer items, all in the bottom bar', () => {
    const items = navItemsFor(makeMe({ role: 'OFFICER' }));
    expect(items).toEqual([
      { label: 'Dashboard', link: '/officer', icon: 'home', primary: true },
      { label: 'Fuel statement', link: '/officer/fuel', icon: 'droplet', primary: true },
    ]);
  });

  it('lists the driver items', () => {
    const items = navItemsFor(makeMe({ role: 'DRIVER' }));
    expect(items).toEqual([
      { label: 'Home', link: '/driver', icon: 'home', primary: true },
      { label: 'Pumps', link: '/driver/pumps', icon: 'compass', primary: true },
      { label: 'Fuel', link: '/driver/fuel', icon: 'card', primary: true },
      { label: 'Live location', link: '/driver/live', icon: 'radio', primary: true },
      { label: 'Odometer', link: '/driver/odometer', icon: 'gauge' },
      { label: 'Fuel statement', link: '/driver/statement', icon: 'droplet' },
    ]);
  });

  describe('pump staff', () => {
    const police = makeMe({ role: 'PUMP_OPERATOR', pump: 4, pump_kind: 'POLICE' });
    const tieUp = makeMe({ role: 'PUMP_OPERATOR', pump: 5, pump_kind: 'TIE_UP' });

    it('see Stock and not Statements at a police pump', () => {
      const items = navItemsFor(police);
      expect(items).toEqual([
        { label: 'Dashboard', link: '/pump', icon: 'home', primary: true },
        { label: 'Fill', link: '/pump/fill', icon: 'fuel', primary: true },
        { label: 'Stock', link: '/pump/stock', icon: 'gauge', primary: true },
        { label: 'Fuel statement', link: '/pump/statement', icon: 'droplet', primary: true },
      ]);
    });

    it('see no Stock at a tie-up bunk, which keeps none', () => {
      const items = navItemsFor(tieUp);
      expect(items).toEqual([
        { label: 'Dashboard', link: '/pump', icon: 'home', primary: true },
        { label: 'Fill', link: '/pump/fill', icon: 'fuel', primary: true },
        { label: 'Fuel statement', link: '/pump/statement', icon: 'droplet', primary: true },
      ]);
    });

    it('see neither when the pump kind is unknown', () => {
      const items = navItemsFor(makeMe({ role: 'PUMP_OPERATOR', pump: null, pump_kind: null }));
      expect(links(items)).toEqual(['/pump', '/pump/fill']);
    });
  });

  it('leaves Alerts and Profile out: they sit at the top right of every page', () => {
    const roles: Role[] = ['PTO', 'MTO', 'OFFICER', 'DRIVER', 'PUMP_OPERATOR'];
    for (const role of roles) {
      const found = links(navItemsFor(makeMe({ role, pump_kind: 'TIE_UP' })));
      expect(found).not.toContain('/alerts');
      expect(found).not.toContain('/profile');
    }
  });

  it('never marks more than four items for the phone bottom bar', () => {
    const roles: Role[] = ['PTO', 'MTO', 'OFFICER', 'DRIVER', 'PUMP_OPERATOR'];
    for (const role of roles) {
      const user: Me = makeMe({ role, pump_kind: 'POLICE' });
      expect(primaryLabels(navItemsFor(user)).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('homePathFor', () => {
  it('maps every role to its area', () => {
    expect(homePathFor('PTO')).toBe('/pto');
    expect(homePathFor('MTO')).toBe('/mto');
    expect(homePathFor('OFFICER')).toBe('/officer');
    expect(homePathFor('DRIVER')).toBe('/driver');
    expect(homePathFor('PUMP_OPERATOR')).toBe('/pump');
  });
});
