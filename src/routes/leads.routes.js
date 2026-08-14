import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// POST /api/leads - manual quick-add (staff phone entry, or the WhatsApp Web extension)
router.post("/", async (req, res) => {
  let { phoneNumber, name } = req.body;
  if (!phoneNumber || !phoneNumber.trim()) {
    return res.status(400).json({ error: "Phone number is required" });
  }
  // Normalize: keep digits only, so "+91 98765 43210" and "9876543210" match the same lead
  phoneNumber = phoneNumber.replace(/[^\d]/g, "");

  const existing = await prisma.lead.findUnique({ where: { phoneNumber } });
  if (existing) {
    // Already exists - just update the name if a better one was given, and reassign to whoever added it
    const updated = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        ...(name && !existing.name && { name }),
        ...((!existing.assignedStaffId) && { assignedStaffId: req.user.id }),
        deleted: false,
        updatedAt: new Date(),
      },
    });
    return res.status(200).json(updated);
  }

  const lead = await prisma.lead.create({
    data: {
      phoneNumber,
      name: name || null,
      assignedStaffId: req.user.id,
      status: "NEW",
    },
  });
  res.status(201).json(lead);
});

// GET /api/leads?status=WAITING&staffId=xxx&search=98765
// Staff see only their assigned leads by default; admin sees all unless filtered.
router.get("/", async (req, res) => {
  const { status, staffId, search } = req.query;

  const where = { deleted: false };
  if (status) where.status = status;
  if (staffId) where.assignedStaffId = staffId;
  if (req.user.role !== "ADMIN" && !staffId) {
    where.assignedStaffId = req.user.id;
  }
  if (search) {
    where.OR = [
      { phoneNumber: { contains: search } },
      { name: { contains: search, mode: "insensitive" } },
    ];
  }

  const leads = await prisma.lead.findMany({
    where,
    include: {
      assignedStaff: { select: { id: true, name: true } },
      followUps: { where: { completed: false }, orderBy: { scheduledAt: "asc" }, take: 1 },
      _count: { select: { notes: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(leads);
});

// GET /api/leads/:id - full detail incl. notes, follow-ups, message history
router.get("/:id", async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, deleted: false },
    include: {
      assignedStaff: { select: { id: true, name: true } },
      notes: { include: { staff: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
      followUps: { include: { staff: { select: { id: true, name: true } } }, orderBy: { scheduledAt: "desc" } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json(lead);
});

// PATCH /api/leads/:id - update name, status, assigned staff
router.patch("/:id", async (req, res) => {
  const { name, status, assignedStaffId } = req.body;
  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(status && { status }),
      ...(assignedStaffId !== undefined && { assignedStaffId }),
    },
  });
  res.json(lead);
});

// DELETE /api/leads/:id - admin only, soft delete
router.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.lead.update({ where: { id: req.params.id }, data: { deleted: true } });
  res.json({ success: true });
});

export default router;
