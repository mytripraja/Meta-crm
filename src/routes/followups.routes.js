import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// POST /api/leads/:leadId/followups
// body: { scheduledAt: ISO string, remindBeforeMinutes: 5|10|60 }
router.post("/:leadId/followups", async (req, res) => {
  const { scheduledAt, remindBeforeMinutes } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: "Pick a follow-up date and time" });

  const followUp = await prisma.followUp.create({
    data: {
      leadId: req.params.leadId,
      staffId: req.user.id,
      scheduledAt: new Date(scheduledAt),
      remindBeforeMinutes: remindBeforeMinutes || 10,
    },
  });
  await prisma.lead.update({
    where: { id: req.params.leadId },
    data: { status: "WAITING", updatedAt: new Date() },
  });
  res.status(201).json(followUp);
});

// PATCH /api/followups/:id/complete
router.patch("/followups/:id/complete", async (req, res) => {
  const followUp = await prisma.followUp.update({
    where: { id: req.params.id },
    data: { completed: true },
  });
  res.json(followUp);
});

// GET /api/followups/upcoming - for the "today's reminders" widget
router.get("/followups/upcoming", async (req, res) => {
  const where = { completed: false, scheduledAt: { gte: new Date() } };
  if (req.user.role !== "ADMIN") where.staffId = req.user.id;

  const followUps = await prisma.followUp.findMany({
    where,
    include: { lead: true },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });
  res.json(followUps);
});

export default router;
