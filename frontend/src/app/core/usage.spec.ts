import { usage } from './usage';

describe('usage', () => {
  it('is the share of the limit used, in whole percent', () => {
    expect(usage('45.50', '90.00')).toEqual({ percent: 51, tone: '' });
    expect(usage('0.00', '90.00')).toEqual({ percent: 0, tone: '' });
  });

  it('turns amber from 80 percent and red at the limit', () => {
    expect(usage('72.00', '90.00').tone).toBe('warning');
    expect(usage('71.00', '90.00').tone).toBe('');
    expect(usage('90.00', '90.00').tone).toBe('danger');
  });

  it('never goes past 100 percent, even over the limit', () => {
    expect(usage('130.00', '90.00')).toEqual({ percent: 100, tone: 'danger' });
  });

  it('counts a limit of zero as full once anything is used', () => {
    expect(usage('5.00', '0.00')).toEqual({ percent: 100, tone: 'danger' });
    expect(usage('0.00', '0.00')).toEqual({ percent: 0, tone: '' });
  });
});
