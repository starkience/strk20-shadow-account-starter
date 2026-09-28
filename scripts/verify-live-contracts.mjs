import { RpcProvider, constants } from 'starknet';

const EXPECTED_ANONYMIZER_CLASS =
  '0x0b61dee4f9f6b243f5310fbfab4224128db5c4815077b6329c232f8fc9af409';
const EXPECTED_SHADOW_CLASS =
  '0x070e76435b6ddb74b11665d3bc3264aaf354f59329976f3ffcb03b2ab992b78f';
const DELEGATED_SCREENING = 2n;

const networks = [
  {
    name: 'Mainnet',
    chainId: constants.StarknetChainId.SN_MAIN,
    rpcUrl:
      process.env.VITE_MAINNET_RPC_URL ??
      'https://api.zan.top/public/starknet-mainnet/rpc/v0_10',
    pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    anonymizer:
      '0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7',
  },
  {
    name: 'Sepolia',
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    rpcUrl:
      process.env.VITE_SEPOLIA_RPC_URL ??
      'https://starknet-sepolia-rpc.publicnode.com',
    pool: '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91',
    anonymizer:
      '0x010a2285310c107c731d997afc147afb7495daff6397c2d242133d9fe8d9b147',
  },
];

function sameFelt(left, right) {
  return BigInt(left) === BigInt(right);
}

async function verify(network) {
  const provider = new RpcProvider({ nodeUrl: network.rpcUrl });
  const [chainId, anonymizerClass, boundPool, shadowClass, screeningPolicy, poolFee] =
    await Promise.all([
      provider.getChainId(),
      provider.getClassHashAt(network.anonymizer),
      provider.callContract({
        contractAddress: network.anonymizer,
        entrypoint: 'get_privacy_contract',
      }),
      provider.callContract({
        contractAddress: network.anonymizer,
        entrypoint: 'get_shadow_account_class_hash',
      }),
      provider.callContract({
        contractAddress: network.pool,
        entrypoint: 'get_open_note_screening_policy',
        calldata: [network.anonymizer],
      }),
      provider.callContract({ contractAddress: network.pool, entrypoint: 'get_fee_amount' }),
    ]);

  const assertions = [
    ['chain id', chainId, network.chainId],
    ['anonymizer class', anonymizerClass, EXPECTED_ANONYMIZER_CLASS],
    ['bound pool', boundPool[0], network.pool],
    ['shadow class', shadowClass[0], EXPECTED_SHADOW_CLASS],
    ['screening policy', screeningPolicy[0], DELEGATED_SCREENING],
  ];
  for (const [label, actual, expected] of assertions) {
    if (actual === undefined || !sameFelt(actual, expected)) {
      throw new Error(
        `${network.name} ${label} mismatch: expected ${String(expected)}, received ${String(actual)}`,
      );
    }
  }
  if (BigInt(poolFee[0] ?? 0) <= 0n) throw new Error(`${network.name} pool fee is not positive`);
  console.log(
    `✓ ${network.name}: canonical anonymizer, shadow class, delegated screening, and pool fee verified`,
  );
}

for (const network of networks) await verify(network);
