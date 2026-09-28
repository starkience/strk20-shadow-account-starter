import { useCallback, useEffect, useMemo, useState } from 'react';
import { createStore } from '@starknet-io/get-starknet-discovery';
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features';
import { RpcProvider, WalletAccountV6, walletV6 } from 'starknet';
import { decodeUint256, formatTokenAmount, parseTokenAmount } from './amounts';
import {
  DAPP_NAME,
  getNetwork,
  REQUIRED_WALLET_API,
  SHADOW_NONCE,
  STRK_DECIMALS,
  STRK_TOKEN,
} from './config';
import {
  buildCollectShadowActions,
  buildFundShadowActions,
  resolveShadowAccount,
  validateDappName,
  type ShadowIdentity,
} from './shadow-account';

const walletStore = createStore({ eip1193Adapters: [] });

type Operation = 'connect' | 'resolve' | 'balance' | 'fund' | 'collect';
type TransactionState = { status: 'wallet' | 'confirming' | 'confirmed' | 'pending'; hash?: string };

function shorten(value: string, size = 6): string {
  return value.length > size * 2 + 2 ? `${value.slice(0, size + 2)}…${value.slice(-size)}` : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole = '', ...fractionParts] = cleaned.split('.');
  return fractionParts.length ? `${whole}.${fractionParts.join('').slice(0, 18)}` : whole;
}

async function waitForConfirmation(provider: RpcProvider, hash: string): Promise<'confirmed' | 'pending'> {
  let timeout: number | undefined;
  try {
    const receipt = await Promise.race([
      provider.waitForTransaction(hash, { retryInterval: 3_000 }),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error('confirmation timeout')), 90_000);
      }),
    ]);
    const execution = 'execution_status' in receipt ? String(receipt.execution_status) : 'SUCCEEDED';
    if (execution.includes('REVERTED')) throw new Error('The transaction reverted.');
    return 'confirmed';
  } catch (error) {
    if (errorMessage(error).includes('confirmation timeout')) return 'pending';
    throw error;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

export default function App() {
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>(() => walletStore.getWallets());
  const [walletMenu, setWalletMenu] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletWithStarknetFeatures>();
  const [account, setAccount] = useState<WalletAccountV6>();
  const [chainId, setChainId] = useState<string>();
  const [versions, setVersions] = useState<string[]>([]);
  const [identity, setIdentity] = useState<ShadowIdentity>();
  const [publicBalance, setPublicBalance] = useState<bigint>();
  const [shieldedBalance, setShieldedBalance] = useState<bigint>();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<Operation>();
  const [transaction, setTransaction] = useState<TransactionState>();
  const [error, setError] = useState<string>();

  const network = getNetwork(chainId);
  const provider = useMemo(
    () => (network ? new RpcProvider({ nodeUrl: network.rpcUrl }) : undefined),
    [network],
  );
  const supportsShadow = versions.includes(REQUIRED_WALLET_API);
  const dappConfigured = (() => {
    try {
      validateDappName(DAPP_NAME);
      return true;
    } catch {
      return false;
    }
  })();

  useEffect(() => walletStore.subscribe((next) => setWallets([...next])), []);

  const resetPrivateState = useCallback(() => {
    setIdentity(undefined);
    setPublicBalance(undefined);
    setShieldedBalance(undefined);
    setTransaction(undefined);
    setError(undefined);
  }, []);

  useEffect(() => {
    if (!selectedWallet) return undefined;
    let cancelled = false;
    const unsubscribe = walletV6.subscribeWalletEvent(selectedWallet, () => {
      resetPrivateState();
      setBusy('connect');
      void (async () => {
        const nextChainId = await walletV6.requestChainId(selectedWallet);
        const nextNetwork = getNetwork(nextChainId);
        if (!nextNetwork) throw new Error('Switch the wallet to Starknet Mainnet or Sepolia.');
        const nextAccount = await WalletAccountV6.connectSilent(
          { nodeUrl: nextNetwork.rpcUrl },
          selectedWallet,
        );
        if (!nextAccount.address) throw new Error('No wallet account is selected.');
        if (!cancelled) {
          setAccount(nextAccount);
          setChainId(nextChainId);
        }
      })()
        .catch((eventError) => {
          if (!cancelled) {
            setAccount(undefined);
            setChainId(undefined);
            setError(`Reconnect wallet: ${errorMessage(eventError)}`);
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(undefined);
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [resetPrivateState, selectedWallet]);

  const connect = async (wallet: WalletWithStarknetFeatures) => {
    setBusy('connect');
    setError(undefined);
    try {
      const [supportedVersions, nextChainId] = await Promise.all([
        walletV6.supportedWalletApi(wallet),
        walletV6.requestChainId(wallet),
      ]);
      const nextNetwork = getNetwork(nextChainId);
      if (!nextNetwork) throw new Error('Switch the wallet to Starknet Mainnet or Sepolia.');
      if (!supportedVersions.includes(REQUIRED_WALLET_API)) {
        throw new Error(`This wallet does not support Wallet API ${REQUIRED_WALLET_API}.`);
      }
      const nextAccount = await WalletAccountV6.connect({ nodeUrl: nextNetwork.rpcUrl }, wallet);
      if (!nextAccount.address) throw new Error('The wallet connected without an account.');
      resetPrivateState();
      setSelectedWallet(wallet);
      setAccount(nextAccount);
      setChainId(nextChainId);
      setVersions([...supportedVersions]);
      setWalletMenu(false);
    } catch (connectError) {
      setError(errorMessage(connectError));
    } finally {
      setBusy(undefined);
    }
  };

  const disconnect = async () => {
    if (selectedWallet) {
      await selectedWallet.features['standard:disconnect'].disconnect().catch(() => undefined);
    }
    resetPrivateState();
    setSelectedWallet(undefined);
    setAccount(undefined);
    setChainId(undefined);
    setVersions([]);
  };

  const refreshPublicBalance = useCallback(
    async (shadowAddress: string) => {
      if (!provider) return;
      const values = await provider.callContract({
        contractAddress: STRK_TOKEN,
        entrypoint: 'balanceOf',
        calldata: [shadowAddress],
      });
      setPublicBalance(decodeUint256(values));
    },
    [provider],
  );

  const resolveIdentity = useCallback(async (): Promise<ShadowIdentity> => {
    if (identity) return identity;
    if (!account || !provider || !network) throw new Error('Connect a supported wallet first.');
    const dappName = validateDappName(DAPP_NAME);
    const partialCommitment = await account.strk20ShadowAccountCommitment(dappName);
    const nextIdentity = await resolveShadowAccount({
      provider,
      anonymizer: network.anonymizer,
      partialCommitment,
      dappName,
      nonce: SHADOW_NONCE,
    });
    setIdentity(nextIdentity);
    await refreshPublicBalance(nextIdentity.address);
    return nextIdentity;
  }, [account, identity, network, provider, refreshPublicBalance]);

  const handleResolve = async () => {
    setBusy('resolve');
    setError(undefined);
    try {
      await resolveIdentity();
    } catch (resolveError) {
      setError(errorMessage(resolveError));
    } finally {
      setBusy(undefined);
    }
  };

  const readShieldedBalance = async () => {
    if (!account) return;
    setBusy('balance');
    setError(undefined);
    try {
      const balances = await account.strk20Balances([STRK_TOKEN]);
      const entry = balances.find((item) => BigInt(item.token) === BigInt(STRK_TOKEN));
      setShieldedBalance(BigInt(entry?.balance ?? 0));
    } catch (balanceError) {
      setError(errorMessage(balanceError));
    } finally {
      setBusy(undefined);
    }
  };

  const submit = async (operation: 'fund' | 'collect') => {
    if (!account || !provider || !network) return;
    setBusy(operation);
    setTransaction({ status: 'wallet' });
    setError(undefined);
    try {
      const resolved = await resolveIdentity();
      const actions =
        operation === 'fund'
          ? buildFundShadowActions({
              identity: resolved,
              token: STRK_TOKEN,
              amount: parseTokenAmount(amount, STRK_DECIMALS),
            })
          : buildCollectShadowActions({
              identity: resolved,
              token: STRK_TOKEN,
              privateRecipient: account.address,
            });
      const result = await account.strk20InvokeTransaction(actions);
      setTransaction({ status: 'confirming', hash: result.transaction_hash });
      const status = await waitForConfirmation(provider, result.transaction_hash);
      setTransaction({ status, hash: result.transaction_hash });
      await refreshPublicBalance(resolved.address);
      setShieldedBalance(undefined);
      if (operation === 'fund') setAmount('');
    } catch (submitError) {
      setTransaction(undefined);
      setError(errorMessage(submitError));
    } finally {
      setBusy(undefined);
    }
  };

  const explorerLink = transaction?.hash && network ? `${network.explorer}/tx/${transaction.hash}` : undefined;
  const ready = Boolean(account && network && supportsShadow && dappConfigured);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Shadow account starter home">
          <span className="wordmark-mark" aria-hidden="true">S/</span>
          <span>SHADOW ACCOUNT STARTER</span>
        </a>
        <div className="wallet-area">
          {account ? (
            <button className="wallet-button connected" onClick={() => void disconnect()}>
              <span className="network-dot" />
              {shorten(account.address)}
            </button>
          ) : (
            <button className="wallet-button" onClick={() => setWalletMenu((value) => !value)}>
              Connect wallet
            </button>
          )}
          {walletMenu && !account && (
            <div className="wallet-menu">
              <p>Privacy-enabled wallets</p>
              {wallets.length ? (
                wallets.map((wallet) => (
                  <button
                    key={`${wallet.name}-${wallet.version}`}
                    onClick={() => void connect(wallet)}
                    disabled={Boolean(busy)}
                  >
                    <img src={wallet.icon} alt="" />
                    <span>{wallet.name}</span>
                    <b>Connect</b>
                  </button>
                ))
              ) : (
                <span className="empty-wallets">Install Ready or Xverse, then refresh.</span>
              )}
            </div>
          )}
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">STARKNET.JS 10.8 · WALLET API 0.10.4</p>
            <h1>One public identity.<br />No direct onchain wallet link.</h1>
          </div>
          <p className="hero-copy">
            A minimal reference for persistent STRK20 shadow accounts. The wallet owns private state;
            the dapp only describes actions.
          </p>
        </section>

        <section className="grid">
          <article className="panel workbench">
            <div className="panel-heading">
              <div>
                <p className="label">LIVE WORKBENCH</p>
                <h2>Move shielded STRK through a shadow account</h2>
              </div>
              <span className={`status ${ready ? 'ready' : ''}`}>{ready ? 'READY' : 'SETUP'}</span>
            </div>

            {!dappConfigured && (
              <div className="notice error-notice">
                Set a unique <code>VITE_SHADOW_DAPP_NAME</code> in <code>.env.local</code>.
              </div>
            )}
            {account && !network && <div className="notice">Switch the wallet to Mainnet or Sepolia.</div>}
            {account && !supportsShadow && (
              <div className="notice error-notice">Wallet API {REQUIRED_WALLET_API} is required.</div>
            )}

            <div className="metrics">
              <div><span>NETWORK</span><strong>{network?.label ?? '—'}</strong></div>
              <div><span>DAPP NAME</span><strong>{DAPP_NAME || 'Not configured'}</strong></div>
              <div><span>NONCE</span><strong>{SHADOW_NONCE}</strong></div>
            </div>

            <div className="identity-block">
              <div>
                <span className="label">SHADOW ACCOUNT</span>
                <strong>{identity ? shorten(identity.address, 10) : 'Not shared'}</strong>
                <small>{identity ? (identity.deployed ? 'Deployed' : 'Deterministic · deploys on first invoke') : 'Resolve once per wallet session'}</small>
              </div>
              <button className="secondary" onClick={() => void handleResolve()} disabled={!ready || Boolean(busy)}>
                {busy === 'resolve' ? 'Waiting for wallet…' : identity ? 'Resolved' : 'Resolve address'}
              </button>
            </div>

            <div className="balance-row">
              <div>
                <span className="label">SHIELDED STRK</span>
                <strong>{shieldedBalance === undefined ? 'Not shared' : `${formatTokenAmount(shieldedBalance, STRK_DECIMALS)} STRK`}</strong>
              </div>
              <button className="text-button" onClick={() => void readShieldedBalance()} disabled={!ready || Boolean(busy)}>
                {busy === 'balance' ? 'Requesting…' : 'Read with consent'}
              </button>
            </div>

            <div className="amount-box">
              <label htmlFor="amount">AMOUNT</label>
              <div>
                <input
                  id="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(normalizeAmountInput(event.currentTarget.value))}
                />
                <span>STRK</span>
              </div>
            </div>

            <button className="primary" onClick={() => void submit('fund')} disabled={!ready || Boolean(busy) || !amount}>
              {busy === 'fund' ? 'Confirm in wallet…' : 'Fund shadow account'}
            </button>

            <div className="public-balance">
              <div>
                <span className="label">PUBLIC SHADOW BALANCE</span>
                <strong>{publicBalance === undefined ? '—' : `${formatTokenAmount(publicBalance, STRK_DECIMALS)} STRK`}</strong>
              </div>
              <button
                className="secondary"
                onClick={() => void submit('collect')}
                disabled={!ready || !identity || !publicBalance || Boolean(busy)}
              >
                {busy === 'collect' ? 'Confirm in wallet…' : 'Return all to shielded balance'}
              </button>
            </div>

            {transaction && (
              <div className="transaction" aria-live="polite">
                <span>{transaction.status === 'wallet' ? 'Generating proof in wallet' : transaction.status === 'confirming' ? 'Submitted · confirming' : transaction.status === 'pending' ? 'Submitted · confirmation pending' : 'Confirmed'}</span>
                {explorerLink && <a href={explorerLink} target="_blank" rel="noreferrer">View transaction ↗</a>}
              </div>
            )}
            {error && <div className="notice error-notice" role="alert">{error}</div>}
          </article>

          <aside className="panel facts">
            <p className="label">WHAT THIS STARTER DOES</p>
            <ol>
              <li><span>01</span><p><strong>Connect</strong>The dapp checks Wallet API support without reading private data.</p></li>
              <li><span>02</span><p><strong>Resolve</strong>The wallet shares one dapp-scoped commitment; the canonical anonymizer returns the address.</p></li>
              <li><span>03</span><p><strong>Invoke</strong>Native STRK20 actions fund the shadow and execute its calls atomically.</p></li>
            </ol>
            <div className="boundary">
              <span className="label">PRIVACY BOUNDARY</span>
              <p>The shadow address, balance, calls, amounts, and timing are public. The protocol flow does not expose the controlling wallet address onchain.</p>
            </div>
            {network && (
              <div className="contracts">
                <a href={`${network.explorer}/contract/${network.anonymizer}`} target="_blank" rel="noreferrer">Canonical anonymizer ↗</a>
                <a href={`${network.explorer}/contract/${network.pool}`} target="_blank" rel="noreferrer">STRK20 pool ↗</a>
              </div>
            )}
          </aside>
        </section>
      </main>

      <footer>
        <span>NO APP-MANAGED KEYS</span>
        <span>NO CUSTOM ANONYMIZER</span>
        <a href="https://github.com/starknet-io/starknet.js/blob/develop/www/docs/guides/account/walletAccount.md#strk20-shadow-accounts" target="_blank" rel="noreferrer">UPSTREAM GUIDE ↗</a>
      </footer>
    </div>
  );
}
