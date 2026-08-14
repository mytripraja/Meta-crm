import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// POST /api/leads/:leadId/notes
router.post("/:leadId/notes", async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Note cannot be empty" });
  }
  const note = await prisma.note.create({
    data: {
      leadId: req.params.leadId,
      staffId: req.user.id,
      content: content.trim(),
    },
    include: { staff: { select: { id: true, name: true } } },
  });
  // touch the lead so it sorts to top of "recently updated"
  await prisma.lead.update({ where: { id: req.params.leadId }, data: { updatedAt: new Date() } });
  res.status(201).json(note);
});

export default router;
