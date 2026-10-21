"use client";

import { useRouter } from "next/navigation";
import { ScanInput } from "./ScanInput";

export function ScanRouter() {
  const router = useRouter();
  return <ScanInput autoFocus onCode={(code) => router.push(`/scan/go?code=${encodeURIComponent(code)}`)} />;
}
