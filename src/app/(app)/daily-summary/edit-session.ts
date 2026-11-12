import type { BankLine } from "@/lib/cash-flow";

import { initialTypedState, typedReducer, type TypedAction, type TypedUiState } from "./typed-reducer";

/**
 * Everything one EDIT of a saved day holds: whether edit mode is open, what is typed (bring-forward, bank lines), the Done by choice and
 * the last refusal. ONE pure state machine, so "Cancel throws the edit away" is a test of the real transition: cancel goes back to the
 * numbers of the saved version, empties Done by, clears the refusal and closes edit mode, and the next Edit starts clean.
 *
 * `epoch` counts the cancels. A save is sent with the epoch it started in; a REFUSAL that comes back after a cancel carries an older
 * epoch and is ignored (it must neither refill Done by nor bring back the old message). A SUCCESS is never ignored: the day was saved.
 */
export type EditOriginal = { bf: string; bank: readonly BankLine[] };

/** What a refusal needs to show: the echoed Done by (rule 14) and whatever the screen renders from it. */
export type EditRefusal = { values: { doneById: string } };

export type EditSession<R extends EditRefusal = EditRefusal> = {
  original: EditOriginal;
  typed: TypedUiState;
  doneById: string;
  editing: boolean;
  refusal: R | null;
  epoch: number;
};

export type EditAction<R extends EditRefusal = EditRefusal> =
  | { type: "start" }
  | { type: "cancel" }
  | { type: "doneBy"; id: string }
  | { type: "typed"; action: TypedAction }
  | { type: "refused"; epoch: number; refusal: R };

export function initialEditSession<R extends EditRefusal = EditRefusal>(original: EditOriginal, epoch = 0): EditSession<R> {
  return { original, typed: initialTypedState({ bf: original.bf, bank: original.bank, preparedId: "", checkedId: "" }, []), doneById: "", editing: false, refusal: null, epoch };
}

export function editSessionReducer<R extends EditRefusal = EditRefusal>(state: EditSession<R>, action: EditAction<R>): EditSession<R> {
  switch (action.type) {
    case "start":
      return { ...state, editing: true };
    case "cancel":
      return initialEditSession<R>(state.original, state.epoch + 1);
    case "doneBy":
      return { ...state, doneById: action.id };
    case "typed":
      return { ...state, typed: typedReducer(state.typed, action.action) };
    case "refused":
      if (action.epoch !== state.epoch) return state; // the edit it belonged to was cancelled
      return { ...state, refusal: action.refusal, doneById: action.refusal.values.doneById };
  }
}
