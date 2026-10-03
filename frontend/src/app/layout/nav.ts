import { Me, Role } from '../core/auth-store';

export type NavItem = {
  label: string;
  link: string;
  icon: string;
  /** Shown in the phone's bottom bar (at most four per role). */
  primary?: boolean;
};

const HOME_PATHS: Readonly<Record<Role, string>> = {
  PTO: '/pto',
  MTO: '/mto',
  OFFICER: '/officer',
  DRIVER: '/driver',
  PUMP_OPERATOR: '/pump',
};

export function homePathFor(role: Role): string {
  return HOME_PATHS[role];
}

function pumpItems(user: Me): NavItem[] {
  const items: NavItem[] = [
    { label: 'Dashboard', link: '/pump', icon: 'home', primary: true },
    { label: 'Fill', link: '/pump/fill', icon: 'fuel', primary: true },
  ];
  // Only a police pump holds stock. Both kinds read the fuel statement: every fill made at the pump.
  if (user.pump_kind === 'POLICE') {
    items.push({ label: 'Stock', link: '/pump/stock', icon: 'gauge', primary: true });
  }
  if (user.pump_kind) {
    items.push({
      label: 'Fuel statement',
      link: '/pump/statement',
      icon: 'droplet',
      primary: true,
    });
  }
  return items;
}

/** Every page the user may open, in menu order. Alerts and Profile are not listed: they sit at the top right of
 * every page. */
export function navItemsFor(user: Me): NavItem[] {
  switch (user.role) {
    case 'PTO':
      return [
        { label: 'Dashboard', link: '/pto', icon: 'home', primary: true },
        { label: 'MTO offices', link: '/pto/units', icon: 'building', primary: true },
        { label: 'Approvals', link: '/pto/approvals', icon: 'check-circle', primary: true },
        { label: 'Vehicles', link: '/pto/vehicles', icon: 'car', primary: true },
        { label: 'Officers', link: '/pto/officers', icon: 'shield' },
        { label: 'Drivers', link: '/pto/drivers', icon: 'user' },
        { label: 'Fuel statement', link: '/pto/statement', icon: 'droplet' },
        { label: 'Bunk statements', link: '/pto/bunk-statements', icon: 'file-text' },
        { label: 'Master lists', link: '/pto/masters', icon: 'list' },
      ];
    case 'MTO':
      return [
        { label: 'Dashboard', link: '/mto', icon: 'home', primary: true },
        { label: 'Vehicles', link: '/mto/vehicles', icon: 'car', primary: true },
        { label: 'Drivers', link: '/mto/drivers', icon: 'user' },
        { label: 'Officers', link: '/mto/officers', icon: 'shield' },
        { label: 'Transfers', link: '/mto/transfers', icon: 'arrow-left-right' },
        { label: 'Pumps', link: '/mto/pumps', icon: 'fuel' },
        { label: 'Additional quota', link: '/mto/additional-quota', icon: 'file-plus' },
        { label: 'Emergencies', link: '/mto/emergencies', icon: 'alert-triangle', primary: true },
        { label: 'Fuel statement', link: '/mto/fuel', icon: 'droplet', primary: true },
        { label: 'Bunk statements', link: '/mto/statements', icon: 'file-text' },
        { label: 'Odometer', link: '/mto/odometer', icon: 'gauge' },
        { label: 'Servicing', link: '/mto/servicing', icon: 'wrench' },
      ];
    case 'OFFICER':
      return [
        { label: 'Dashboard', link: '/officer', icon: 'home', primary: true },
        { label: 'Fuel statement', link: '/officer/fuel', icon: 'droplet', primary: true },
      ];
    case 'DRIVER':
      return [
        { label: 'Home', link: '/driver', icon: 'home', primary: true },
        { label: 'Pumps', link: '/driver/pumps', icon: 'compass', primary: true },
        { label: 'Fuel', link: '/driver/fuel', icon: 'card', primary: true },
        { label: 'Odometer', link: '/driver/odometer', icon: 'gauge', primary: true },
        { label: 'Fuel statement', link: '/driver/statement', icon: 'droplet' },
      ];
    case 'PUMP_OPERATOR':
      return pumpItems(user);
  }
}
