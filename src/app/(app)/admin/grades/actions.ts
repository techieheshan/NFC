"use server";

import {
  createLabel,
  setLabelActive,
  updateLabel,
  type ActionState,
} from "@/app/(app)/admin/_lib/label-crud";

const PATH = "/admin/grades";

export async function createGrade(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return createLabel("grade", PATH, formData);
}

export async function updateGrade(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return updateLabel("grade", PATH, formData);
}

export async function setGradeActive(formData: FormData): Promise<void> {
  return setLabelActive("grade", PATH, formData);
}
