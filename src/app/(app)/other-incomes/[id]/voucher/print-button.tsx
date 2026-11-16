"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The only interactive part of the voucher. */
export function PrintButton() {
  return (
    <Button className="min-h-11 gap-2" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      Print
    </Button>
  );
}
