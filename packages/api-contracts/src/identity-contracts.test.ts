import { describe, expect, it } from 'vitest';

import { registerInputSchema, updateProfileInputSchema } from './identity-contracts';

describe('identity contracts', () => {
  it('normalizes canonical identity fields', () => {
    expect(
      registerInputSchema.parse({
        email: 'Ada@Example.com',
        password: 'a-secure-password',
        username: 'Ada.L',
        displayName: ' Ada ',
      }),
    ).toMatchObject({ email: 'ada@example.com', username: 'ada.l', displayName: 'Ada' });
  });

  it('rejects empty profile patches and unsafe usernames', () => {
    expect(updateProfileInputSchema.safeParse({}).success).toBe(false);
    expect(updateProfileInputSchema.safeParse({ username: '../admin' }).success).toBe(false);
  });
});
