"use server";

import {
  createLabel,
  setLabelActive,
  updateLabel,
  type ActionState,
} from "@/app/(app)/admin/_lib/label-crud";

const PATH = "/admin/subjects";

export async function createSubject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return createLabel("subject", PATH, formData);
}

export async function updateSubject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return updateLabel("subject", PATH, formData);
}

export async function setSubjectActive(formData: FormData): Promise<void> {
  return setLabelActive("subject", PATH, formData);
}
