import { describe, it, expect } from 'vitest';
import { SHARED_VERSION } from '../src/index';

describe('workspace', () => {
  it('resolves the shared package', () => {
    expect(SHARED_VERSION).toBe('0.1.0');
  });
});
