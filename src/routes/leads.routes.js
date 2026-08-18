import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { sendPushToUser } from "../services/push.service.js";
import { trackLeadStageChange } from "../services/lead-stage-tracker.js";

const router = Router();
router.use(requireAuth);

// POST /api/leads - manual quick-add (staff phone entry, or the WhatsApp Web extension)
router.post("/", async (req, res) => {
  let { phoneNumber, name, source } = req.body;
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
      source: source || "MANUAL",
    },
  });

  // Send push notification to admins + assigned staff about new lead
  try {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    const pushPayload = {
      title: "New Lead Added",
      body: `${lead.name || lead.phoneNumber} was added from WhatsApp`,
      leadId: lead.id,
    };
    for (const admin of admins) {
      sendPushToUser(admin.id, pushPayload).catch(() => {});
    }
    if (lead.assignedStaffId) {
      sendPushToUser(lead.assignedStaffId, pushPayload).catch(() => {});
    }
  } catch (_) { /* don't block lead creation if push fails */ }

  res.status(201).json(lead);
});

// GET /api/leads/check-phones?phones=919876543210,918765432109
// Batch phone lookup for the WhatsApp extension - returns a map of phone -> lead info
router.get("/check-phones", async (req, res) => {
  try {
    const phones = req.query.phones ? req.query.phones.split(",").map((p) => p.replace(/\D/g, "")) : [];
    if (phones.length === 0) return res.json({});

    const leads = await prisma.lead.findMany({
      where: { phoneNumber: { in: phones }, deleted: false },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        status: true,
        assignedStaff: { select: { name: true } },
      },
    });

    const map = {};
    leads.forEach((l) => {
      map[l.phoneNumber] = {
        id: l.id,
        name: l.name,
        status: l.status,
        assignedTo: l.assignedStaff?.name || null,
      };
    });
    res.json(map);
  } catch (err) {
    console.error("check-phones error:", err);
    res.status(500).json({ error: "Failed to check phones" });
  }
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

  const oldLead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  const oldStatus = oldLead?.status;

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(status && { status }),
      ...(assignedStaffId !== undefined && { assignedStaffId }),
    },
  });

  // Send push notification on status change
  if (status && lead.assignedStaffId) {
    sendPushToUser(lead.assignedStaffId, {
      title: "Lead Status Updated",
      body: `${lead.name || lead.phoneNumber} → ${status}`,
      leadId: lead.id,
    }).catch(() => {});
  }

  // Track status change for Meta Conversion API
  if (status && status !== oldStatus) {
    trackLeadStageChange(lead.id, status, oldStatus).catch(() => {});
  }

  res.json(lead);
});

// POST /api/leads/:id/quick-update - combined status + note update (for WhatsApp extension)
router.post("/:id/quick-update", async (req, res) => {
  try {
    const { status, note } = req.body;

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
      },
    });

    if (note && note.trim()) {
      await prisma.note.create({
        data: {
          leadId: req.params.id,
          staffId: req.user.id,
          content: note.trim(),
        },
      });
    }

    // Notify assigned staff if someone else made the update
    if (status && lead.assignedStaffId && lead.assignedStaffId !== req.user.id) {
      sendPushToUser(lead.assignedStaffId, {
        title: "Lead Updated",
        body: `${lead.name || lead.phoneNumber} → ${status}${note ? " (note added)" : ""}`,
        leadId: lead.id,
      }).catch(() => {});
    }

    res.json({ success: true, lead });
  } catch (err) {
    console.error("quick-update error:", err);
    res.status(500).json({ error: "Failed to update lead" });
  }
});

// DELETE /api/leads/:id - admin only, soft delete
router.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.lead.update({ where: { id: req.params.id }, data: { deleted: true } });
  res.json({ success: true });
});

export default router;
