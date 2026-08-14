import { PrismaClient } from "@prisma/client";

// Reuse a single Prisma instance across the app (avoids exhausting DB connections)
const prisma = new PrismaClient();

export default prisma;
