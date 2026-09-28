import { shortString, type Call, type RpcProvider, type STRK20_ACTION } from 'starknet';

type ShadowReadProvider = Pick<RpcProvider, 'callContract'>;

export type ShadowIdentity = {
  partialCommitment: string;
  address: string;
  deployed: boolean;
  dappName: string;
  nonce: string;
};

export function validateDappName(name: string): string {
  const value = name.trim();
  if (!value || value === 'replace-with-your-app-name') {
    throw new Error('Set a unique VITE_SHADOW_DAPP_NAME in .env.local.');
  }
  try {
    shortString.encodeShortString(value);
  } catch {
    throw new Error('The dapp name must fit in a Cairo short string (31 ASCII characters).');
  }
  return value;
}

export async function resolveShadowAccount({
  provider,
  anonymizer,
  partialCommitment,
  dappName,
  nonce,
}: {
  provider: ShadowReadProvider;
  anonymizer: string;
  partialCommitment: string;
  dappName: string;
  nonce: string;
}): Promise<ShadowIdentity> {
  const nonceValue = BigInt(nonce);
  if (nonceValue < 0n || nonceValue > 0xffff_ffff_ffff_ffffn) {
    throw new Error('The shadow nonce must fit in u64.');
  }
  const result = await provider.callContract({
    contractAddress: anonymizer,
    entrypoint: 'get_shadow_accounts',
    calldata: [partialCommitment, nonce, `0x${(nonceValue + 1n).toString(16)}`, '0x0'],
  });
  if (result.length < 4 || BigInt(result[0] ?? 0) !== 1n) {
    throw new Error('The canonical anonymizer did not return exactly one shadow account.');
  }
  const returnedNonce = result[1];
  const address = result[2];
  const deployed = result[3];
  if (!returnedNonce || !address || deployed === undefined || BigInt(returnedNonce) !== nonceValue) {
    throw new Error('The canonical anonymizer returned malformed shadow-account data.');
  }
  return {
    partialCommitment,
    address,
    deployed: BigInt(deployed) !== 0n,
    dappName: validateDappName(dappName),
    nonce,
  };
}

function zeroTransfer(token: string, recipient: string): Call {
  return {
    contractAddress: token,
    entrypoint: 'transfer',
    calldata: [recipient, '0x0', '0x0'],
  };
}

export function buildFundShadowActions({
  identity,
  token,
  amount,
}: {
  identity: ShadowIdentity;
  token: string;
  amount: bigint;
}): STRK20_ACTION[] {
  if (amount <= 0n) throw new Error('The funding amount must be positive.');
  return [
    {
      type: 'withdraw',
      token,
      amount: `0x${amount.toString(16)}`,
      recipient: identity.address,
    },
    {
      type: 'shadow_account_invoke',
      dapp_name: identity.dappName,
      nonce: identity.nonce,
      calls: [zeroTransfer(token, identity.address)],
      collect_policy: { type: 'exact', amount: '0x0' },
    },
  ];
}

export function buildCollectShadowActions({
  identity,
  token,
  privateRecipient,
}: {
  identity: ShadowIdentity;
  token: string;
  privateRecipient: string;
}): STRK20_ACTION[] {
  return [
    { type: 'transfer', token, amount: 'OPEN', recipient: privateRecipient },
    {
      type: 'shadow_account_invoke',
      dapp_name: identity.dappName,
      nonce: identity.nonce,
      calls: [zeroTransfer(token, identity.address)],
      collect_policy: { type: 'all' },
    },
  ];
}
