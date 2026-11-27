// Server-only: low-level instruction helpers for relayer-built transactions.
// Transactions are always assembled server-side from validated params — never from client bytes.
import "server-only";
import { address, getUtf8Encoder, type Address, type Instruction } from "@solana/kit";
import type { SerializedInstructionPayload } from "@cartridgefi/sdk";
import { COMPUTE_BUDGET_PROGRAM_ID, MEMO_PROGRAM_ID, SYSTEM_PROGRAM_ID, getRelayerRpc } from "./config";

/** Rebuilds a kit Instruction from the SDK's serialized Codama payload (signers resolve via fee payer / attached signers). */
export function deserializeInstruction(payload: SerializedInstructionPayload): Instruction {
  const hex = payload.dataHex;
  const data = new Uint8Array(hex.length / 2);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return {
    programAddress: address(payload.programAddress),
    accounts: payload.accounts.map((a) => ({ address: address(a.address), role: a.role })),
    data,
  };
}

export function computeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: address(COMPUTE_BUDGET_PROGRAM_ID), data };
}

export function systemTransferIx(from: Address, to: Address, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: address(SYSTEM_PROGRAM_ID),
    accounts: [
      { address: from, role: 3 }, // writable signer
      { address: to, role: 1 }, // writable
    ],
    data,
  };
}

export function memoIx(text: string): Instruction {
  return { programAddress: address(MEMO_PROGRAM_ID), data: new Uint8Array(getUtf8Encoder().encode(text)) };
}

export function sweepTransferIx(from: Address, to: Address, lamports: bigint): Instruction {
  return systemTransferIx(from, to, lamports);
}

export async function fetchAccountsData(addresses: Address[]): Promise<(Uint8Array | null)[]> {
  const rpc = getRelayerRpc();
  const res = await rpc
    .getMultipleAccounts(addresses, { encoding: "base64", commitment: "confirmed" })
    .send();
  return res.value.map((acc) => (acc ? new Uint8Array(Buffer.from(acc.data[0], "base64")) : null));
}
