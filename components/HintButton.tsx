"use client";

import { useState, useTransition } from "react";
import { passwordHint } from "@/app/login/hint";

/** "Show password hint" on the sign-in page, after a wrong password. Uses whatever is in the username box. */
export function HintButton() {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 text-center text-sm">
      <button
        type="button"
        className="link"
        data-testid="show-hint"
        disabled={pending}
        onClick={() => {
          const u = (document.querySelector('input[name="email"]') as HTMLInputElement | null)?.value ?? "";
          if (!u.trim()) return setText("Type your username first.");
          start(async () => setText(await passwordHint(u)));
        }}
      >
        {pending ? "Looking…" : "Show password hint"}
      </button>
      {text && (
        <p className="pop-in mt-2 rounded-md bg-stone-100 px-3 py-2 text-stone-700" role="status">
          {text}
        </p>
      )}
    </div>
  );
}
