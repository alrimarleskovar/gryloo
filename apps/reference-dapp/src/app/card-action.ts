// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { cardVaultStatus, type CardVaultStatus } from '../server/card-vault';

/** Whether a card provider's secure hosted entry is available. It accepts no card data and never will. */
export async function cardProviderStatus(): Promise<CardVaultStatus> {
  return cardVaultStatus();
}
