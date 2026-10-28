import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';

const keys = (o: Record<string, unknown>, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
  );

describe('translations', () => {
  it('ar and en define exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  it('no empty strings', () => {
    for (const m of [ar, en]) expect(JSON.stringify(m)).not.toContain('""');
  });
});
