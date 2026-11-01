/** Shown while the receipts are read: plain words, nothing to tap. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3" role="status">
      <h1 className="text-xl font-bold">Receipts</h1>
      <p className="rounded-2xl border border-dashed border-[#D8D2E6] p-5 text-center text-sm text-[#5B5670]">
        Loading receipts…
      </p>
    </div>
  );
}
