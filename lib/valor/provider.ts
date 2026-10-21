import { valorConnect } from "./connect";

/**
 * A payment terminal provider. The app sends a sale to a terminal, then asks
 * for its status until the customer has tapped/inserted a card (or it times out).
 *
 * Two providers:
 * - "simulator" (default): no hardware. The screen shows a simulated terminal
 *   with Approve / Decline / Time out buttons.
 * - "valor": Valor Connect (cloud to terminal). Turned on with VALOR_MODE=live
 *   plus VALOR_CONNECT_URL, VALOR_APP_ID and VALOR_APP_KEY from Valor.
 */
export type TerminalInfo = { id: string; name: string; epi: string; serial_no: string | null; model: string };

export type SaleRequest = {
  reqTxnId: string; // our id, sent as REQ_TXN_ID
  amount: number; // dollars
  tipEntry: boolean;
  invoiceRef: string; // sent as INVOICENUMBER
};

export type TerminalResult =
  | { status: "pending"; providerRef?: string; message?: string }
  | {
      status: "approved" | "declined" | "timeout" | "cancelled" | "error";
      message?: string;
      card_brand?: string;
      card_last4?: string;
      auth_code?: string;
      txn_id?: string;
      tip?: number;
      provider_ref?: string;
      raw?: unknown;
    };

export interface TerminalProvider {
  name: "simulator" | "valor";
  startSale(t: TerminalInfo, r: SaleRequest): Promise<TerminalResult>;
  getStatus(t: TerminalInfo, r: SaleRequest & { providerRef?: string | null }): Promise<TerminalResult>;
  cancel(t: TerminalInfo, r: SaleRequest & { providerRef?: string | null }): Promise<void>;
}

/** How long a terminal waits for the card. Valor Connect allows up to 180s. */
export const TERMINAL_TIMEOUT_MS = 180_000;

const simulator: TerminalProvider = {
  name: "simulator",
  // The simulated terminal answers through the on-screen buttons (see simulateTerminal).
  async startSale() {
    return { status: "pending", message: "Waiting for card on the simulated terminal" };
  },
  async getStatus() {
    return { status: "pending" };
  },
  async cancel() {},
};

export function valorConfigured() {
  return (
    process.env.VALOR_MODE === "live" &&
    !!process.env.VALOR_CONNECT_URL &&
    !!process.env.VALOR_APP_ID &&
    !!process.env.VALOR_APP_KEY
  );
}

export function getProvider(): TerminalProvider {
  return valorConfigured() ? valorConnect : simulator;
}

/** A believable approval from the simulator. */
export function simulatedApproval(amount: number, tip = 0): TerminalResult {
  const brands = ["Visa", "Mastercard", "Amex", "Discover"];
  const n = Math.floor(Math.random() * 1e9);
  return {
    status: "approved",
    message: "Approved (simulated)",
    card_brand: brands[n % brands.length],
    card_last4: String(1000 + (n % 9000)),
    auth_code: n.toString(36).toUpperCase().slice(0, 6).padEnd(6, "0"),
    txn_id: `SIM-${Date.now().toString(36).toUpperCase()}`,
    tip,
    raw: { simulated: true, amount },
  };
}
