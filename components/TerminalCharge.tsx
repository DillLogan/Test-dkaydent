"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "./SubmitButton";

type Status = "pending" | "approved" | "declined" | "timeout" | "cancelled" | "error";

const TITLE: Record<Status, string> = {
  pending: "Waiting for the card…",
  approved: "Approved",
  declined: "Declined",
  timeout: "Timed out",
  cancelled: "Cancelled",
  error: "Terminal error",
};

/**
 * Live status of a payment sent to a terminal. Polls until the terminal answers,
 * then refreshes the page. With the simulator, shows the simulated terminal's buttons.
 */
export function TerminalCharge({
  requestId,
  initialStatus,
  initialMessage,
  terminalName,
  amount,
  simulated,
  startedAt,
  approve,
  decline,
  timeout,
  cancel,
}: {
  requestId: string;
  initialStatus: Status;
  initialMessage: string | null;
  terminalName: string;
  amount: string;
  simulated: boolean;
  startedAt: string;
  approve: () => Promise<void>;
  decline: () => Promise<void>;
  timeout: () => Promise<void>;
  cancel: () => Promise<void>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [message, setMessage] = useState(initialMessage);
  const [elapsed, setElapsed] = useState(0);
  const refreshed = useRef(initialStatus !== "pending");

  useEffect(() => {
    setStatus(initialStatus);
    setMessage(initialMessage);
    refreshed.current = initialStatus !== "pending";
  }, [initialStatus, initialMessage]);

  useEffect(() => {
    if (status !== "pending") return;
    let stop = false;
    const tick = async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)));
      try {
        const res = await fetch(`/api/terminal/${requestId}`, { cache: "no-store" });
        const j = await res.json();
        if (stop || !j.status) return;
        if (j.status !== "pending") {
          setStatus(j.status);
          setMessage(j.message);
          if (!refreshed.current) {
            refreshed.current = true;
            router.refresh();
          }
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [status, requestId, startedAt, router]);

  const tone =
    status === "approved"
      ? "border-brand-500 bg-brand-50"
      : status === "pending"
        ? "border-blue-200 bg-blue-50"
        : "border-red-200 bg-red-50";

  return (
    <div className={`card space-y-3 border-2 ${tone}`} role="status" aria-live="polite" data-terminal-status={status}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm text-stone-500">{terminalName}</div>
          <div className="text-xl font-semibold">
            {TITLE[status]} · {amount}
          </div>
          {message && status !== "pending" && <div className="text-sm text-stone-700">{message}</div>}
          {status === "pending" && (
            <div className="text-sm text-stone-600">
              Ask the customer to tap, insert or swipe. {elapsed > 0 && `${elapsed}s`} (times out after 3 minutes)
            </div>
          )}
        </div>
        {status === "pending" && (
          <form action={cancel}>
            <SubmitButton className="btn" pendingText="Cancelling…">
              Cancel on terminal
            </SubmitButton>
          </form>
        )}
      </div>
      {status === "pending" && simulated && (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-3">
          <div className="mb-2 text-xs text-stone-500">
            Simulated terminal (no Valor device connected yet). Choose what the customer&apos;s card does:
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={approve}>
              <SubmitButton pendingText="…">Approve card</SubmitButton>
            </form>
            <form action={decline}>
              <SubmitButton className="btn btn-danger" pendingText="…">
                Decline card
              </SubmitButton>
            </form>
            <form action={timeout}>
              <SubmitButton className="btn" pendingText="…">
                Customer walks away (time out)
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
