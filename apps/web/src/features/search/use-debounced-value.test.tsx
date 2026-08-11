import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from './use-debounced-value';

describe('useDebouncedValue', () => {
  afterEach(() => vi.useRealTimers());

  it('does not publish every keypress', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: 'al' },
    });
    rerender({ value: 'alex' });
    expect(result.current).toBe('al');
    await act(() => vi.advanceTimersByTime(349));
    expect(result.current).toBe('al');
    await act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('alex');
  });
});
