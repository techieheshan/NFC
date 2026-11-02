import { MAX_BANK_LINES, type BankLine } from "@/lib/cash-flow";

import { afterBankChange, afterBfInput } from "./notices";

/**
 * Everything the cashier TYPES on the day screen, and which notices are still open, as ONE pure state machine. The day
 * screen drives this reducer (`useReducer`) and does nothing else to these values, so a test that feeds it actions is a
 * test of the real transitions: the notice about a bad bring-forward goes when a VALID amount is typed, the one about bank
 * lines when a line is added or removed, and the bank list never holds more than ten lines. Nothing here is stored; the
 * screen mirrors the state into the address.
 */
export type TypedUiState = {
  bfText: string;
  bank: BankLine[];
  preparedId: string;
  checkedId: string;
  /** Notice keys still showing (`bf`, `bank`). */
  openNotices: string[];
};

export type TypedAction =
  | { type: "bf"; text: string }
  | { type: "bankAdd"; line: BankLine }
  | { type: "bankRemove"; index: number }
  | { type: "prepared"; id: string }
  | { type: "checked"; id: string };

export function initialTypedState(
  initial: { bf: string; bank: readonly BankLine[]; preparedId: string; checkedId: string },
  noticeKeys: readonly string[],
): TypedUiState {
  return { bfText: initial.bf, bank: [...initial.bank], preparedId: initial.preparedId, checkedId: initial.checkedId, openNotices: [...noticeKeys] };
}

export function typedReducer(state: TypedUiState, action: TypedAction): TypedUiState {
  switch (action.type) {
    case "bf":
      return { ...state, bfText: action.text, openNotices: afterBfInput(state.openNotices, action.text) };
    case "bankAdd":
      if (state.bank.length >= MAX_BANK_LINES) return state; // the screen disables the button at ten; the reducer holds the line too
      return { ...state, bank: [...state.bank, action.line], openNotices: afterBankChange(state.openNotices) };
    case "bankRemove":
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= state.bank.length) return state;
      return { ...state, bank: state.bank.filter((_, i) => i !== action.index), openNotices: afterBankChange(state.openNotices) };
    case "prepared":
      return { ...state, preparedId: action.id };
    case "checked":
      return { ...state, checkedId: action.id };
  }
}
