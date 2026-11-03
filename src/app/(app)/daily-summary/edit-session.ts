import type { BankLine } from "@/lib/cash-flow";

import { initialTypedState, typedReducer, type TypedAction, type TypedUiState } from "./typed-reducer";

/**
 * Everything one EDIT of a saved day holds: whether edit mode is open, what is typed (bring-forward, bank lines) and the Done by choice.
 * ONE pure state machine, so "Cancel throws the edit away" is a test of the real transition: cancel goes back to the numbers of the saved
 * version, empties Done by and closes edit mode, and the next Edit starts clean.
 */
export type EditOriginal = { bf: string; bank: readonly BankLine[] };

export type EditSession = {
  original: EditOriginal;
  typed: TypedUiState;
  doneById: string;
  editing: boolean;
};

export type EditAction = { type: "start" } | { type: "cancel" } | { type: "doneBy"; id: string } | { type: "typed"; action: TypedAction };

export function initialEditSession(original: EditOriginal): EditSession {
  return { original, typed: initialTypedState({ bf: original.bf, bank: original.bank, preparedId: "", checkedId: "" }, []), doneById: "", editing: false };
}

export function editSessionReducer(state: EditSession, action: EditAction): EditSession {
  switch (action.type) {
    case "start":
      return { ...state, editing: true };
    case "cancel":
      return initialEditSession(state.original);
    case "doneBy":
      return { ...state, doneById: action.id };
    case "typed":
      return { ...state, typed: typedReducer(state.typed, action.action) };
  }
}
