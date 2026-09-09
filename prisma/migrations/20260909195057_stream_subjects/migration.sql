-- CreateTable
CREATE TABLE "_StreamSubjects" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_StreamSubjects_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_StreamSubjects_B_index" ON "_StreamSubjects"("B");

-- AddForeignKey
ALTER TABLE "_StreamSubjects" ADD CONSTRAINT "_StreamSubjects_A_fkey" FOREIGN KEY ("A") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StreamSubjects" ADD CONSTRAINT "_StreamSubjects_B_fkey" FOREIGN KEY ("B") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

