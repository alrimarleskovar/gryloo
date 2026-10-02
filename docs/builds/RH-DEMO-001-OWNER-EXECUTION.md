# RH-DEMO-001 — owner execution (one wallet confirmation)

Status before you act: **READY_FOR_OWNER_EXECUTION**. You send one native
test-ETH self-transfer on Robinhood Chain Testnet (46630) from your own wallet
to the same address. The value comes back to you; only the network fee (about
0.0000003 test ETH) is spent. Gryloo never sees your key and never signs.

## Before you start

- Use a browser wallet (for example MetaMask) on a **plain EOA account**, not a
  smart account or EIP-7702 delegated account. Gryloo refuses code-bearing
  owners at Simulate.
- The account needs a little Robinhood Testnet ETH. 0.0001 is plenty. Get it
  from the official faucet: <https://faucet.testnet.chain.robinhood.com>.
- The wallet should have no pending transaction on Robinhood Testnet.
- If your wallet offers "smart transactions" or gas sponsorship for this
  network, turn it off for this one request. Keep the fee the page suggests;
  raising it makes the result DIVERGENT.

## Steps

1. Start the app in live mode from the repository root on branch
   `claude/rh-demo-001`:

   ```sh
   pnpm install --frozen-lockfile --offline && pnpm build
   GRYLOO_ROBINHOOD_TESTNET=live GRYLOO_ROBINHOOD_JOURNAL="$HOME/.gryloo/rh-demo-001" \
     pnpm --filter @defi-workflow-engine/reference-dapp dev
   ```

2. Open <http://127.0.0.1:3000>, then:
   1. Click **Advanced action setup**, then **Review transfer proposal**
      (default 0.000001 ETH), then **Apply proposal**.
   2. Click **Continue to Simulate**, then **Simulate transfer**, and connect
      the wallet if asked.
   3. Click **Review transfer** and check the fields: Robinhood Chain Testnet
      46630, owner = recipient = your address, value, nonce, fee budget. Then
      click **Accept transfer review**. If the page offers **Switch to
      Robinhood Chain Testnet**, click it first.
   4. Click **Execute** within two minutes of Simulate, then **confirm once in
      your wallet**.

3. Wait for **Evidence state: TESTNET_EXECUTED / RECONCILED**. This usually
   takes a few seconds; if needed, click **Observe existing transaction**.
   Never resend from the wallet.

Then tell Claude "executed". Claude runs the strictly read-only independent
verifier against the journal in `$HOME/.gryloo/rh-demo-001`:

```sh
node scripts/verify-robinhood-transfer.mjs "$HOME/.gryloo/rh-demo-001/<run>.jsonl" docs/builds/RH-DEMO-001-VERIFICATION.json
```

If it passes, the state becomes **TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED**.
Claude then archives the evidence in the PR. Claude never signs or sends.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| You rejected in the wallet | Nothing was sent. Click **Prepare fresh review** and repeat from step 2.3. |
| "The wallet result is uncertain" | Do not resend. Click **Observe existing transaction**; Gryloo finds the transaction by nonce. |
| "Review expired" or "Wallet state changed" | Repeat from step 2.2 (Simulate). |
| "The owner account has code" | Switch to a plain EOA account. |
