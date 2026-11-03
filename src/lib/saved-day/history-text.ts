/** "Saved by Sadun" for a day never edited, "Saved by Sadun · edited by Thilini" after that (History rows). */
export const savedByText = (r: { version: number; preparedByName: string; doneByName: string }): string =>
  r.version === 1 ? `Saved by ${r.preparedByName}` : `Saved by ${r.preparedByName} · edited by ${r.doneByName}`;
