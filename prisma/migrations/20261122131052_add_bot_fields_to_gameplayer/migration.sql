-- AlterTable
ALTER TABLE "GamePlayer" ADD COLUMN     "botLevel" VARCHAR(16),
ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false;
