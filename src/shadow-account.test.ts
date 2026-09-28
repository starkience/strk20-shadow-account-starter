import { describe, expect, it, vi } from 'vitest';
import {
  buildCollectShadowActions,
  buildFundShadowActions,
  resolveShadowAccount,
  validateDappName,
} from './shadow-account';

const identity = {
  partialCommitment: '0x44',
  address: '0xabc',
  deployed: false,
  dappName: 'my-private-vault',
  nonce: '0x0',
};

describe('shadow accounts', () => {
  it('requires a unique, valid dapp namespace', () => {
    expect(validateDappName('my-private-vault')).toBe('my-private-vault');
    expect(() => validateDappName('replace-with-your-app-name')).toThrow();
    expect(() => validateDappName('x'.repeat(32))).toThrow();
  });

  it('resolves one nonce through the canonical range view', async () => {
    const callContract = vi.fn().mockResolvedValue(['0x1', '0x0', '0xabc', '0x0']);
    await expect(
      resolveShadowAccount({
        provider: { callContract },
        anonymizer: '0x999',
        partialCommitment: '0x44',
        dappName: identity.dappName,
        nonce: '0x0',
      }),
    ).resolves.toEqual(identity);
    expect(callContract).toHaveBeenCalledWith({
      contractAddress: '0x999',
      entrypoint: 'get_shadow_accounts',
      calldata: ['0x44', '0x0', '0x1', '0x0'],
    });
  });

  it('funds and invokes atomically with native STRK20 actions', () => {
    const actions = buildFundShadowActions({ identity, token: '0xstrk', amount: 25n });
    expect(actions.map((action) => action.type)).toEqual(['withdraw', 'shadow_account_invoke']);
    expect(actions[0]).toMatchObject({ amount: '0x19', recipient: identity.address });
    expect(actions[1]).toMatchObject({
      dapp_name: identity.dappName,
      nonce: identity.nonce,
      collect_policy: { type: 'exact', amount: '0x0' },
    });
  });

  it('creates the open note before collecting the public shadow balance', () => {
    const actions = buildCollectShadowActions({
      identity,
      token: '0xstrk',
      privateRecipient: '0xuser',
    });
    expect(actions.map((action) => action.type)).toEqual(['transfer', 'shadow_account_invoke']);
    expect(actions[0]).toMatchObject({ amount: 'OPEN', recipient: '0xuser' });
    expect(actions[1]).toMatchObject({ collect_policy: { type: 'all' } });
  });
});
