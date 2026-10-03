import { Subject, throwError } from 'rxjs';
import { Panel } from './panel';

describe('Panel', () => {
  it('starts out loading, with nothing to show', () => {
    const panel = new Panel(() => new Subject<string>());
    expect(panel.loading()).toBe(true);
    expect(panel.data()).toBeNull();
    expect(panel.error()).toBe('');
    expect(panel.requested).toBe(false);
  });

  it('keeps what the server answers', () => {
    const source = new Subject<string>();
    const panel = new Panel(() => source);
    panel.load();
    expect(panel.requested).toBe(true);
    source.next('rows');
    expect(panel.data()).toBe('rows');
    expect(panel.loading()).toBe(false);
  });

  it('keeps the readable message of a failure, and tries again', () => {
    let fail = true;
    const source = new Subject<string>();
    const panel = new Panel(() =>
      fail ? throwError(() => ({ status: 500, error: { detail: 'Not available.' } })) : source,
    );
    panel.load();
    expect(panel.error()).toBe('Not available.');
    expect(panel.loading()).toBe(false);
    fail = false;
    panel.load();
    expect(panel.error()).toBe('');
    expect(panel.loading()).toBe(true);
    source.next('rows');
    expect(panel.data()).toBe('rows');
  });

  it('leaves the old rows on screen during a quiet load', () => {
    const first = new Subject<string>();
    const second = new Subject<string>();
    const sources = [first, second];
    const panel = new Panel(() => sources.shift()!);
    panel.load();
    first.next('old');
    panel.load(true);
    expect(panel.loading()).toBe(false);
    expect(panel.data()).toBe('old');
    second.next('new');
    expect(panel.data()).toBe('new');
  });

  it('ignores an answer that has been overtaken by a newer load', () => {
    const first = new Subject<string>();
    const second = new Subject<string>();
    const sources = [first, second];
    const panel = new Panel(() => sources.shift()!);
    panel.load();
    panel.load();
    second.next('new');
    first.next('old');
    expect(panel.data()).toBe('new');
  });

  it('ignores an answer that arrives after a reset', () => {
    const source = new Subject<string>();
    const panel = new Panel(() => source);
    panel.load();
    panel.reset();
    source.next('late');
    expect(panel.data()).toBeNull();
    expect(panel.loading()).toBe(true);
    expect(panel.requested).toBe(false);
  });

  it('takes a value that is already known', () => {
    const panel = new Panel(() => new Subject<string>());
    panel.set('known');
    expect(panel.data()).toBe('known');
    expect(panel.loading()).toBe(false);
  });
});
