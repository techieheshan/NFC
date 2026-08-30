"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The only interactive part of the voucher, so it is the only client code. */
export function PrintButton() {
  return (
    <Button className="gap-2" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      Print voucher
    </Button>
  );
}
