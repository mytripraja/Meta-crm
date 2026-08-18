import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// POST /api/mobile/whatsapp-capture
// Called by the Android NotificationListenerService when a WhatsApp notification arrives
// Uses a simple API key for device auth (no JWT needed for background service)
const CAPTURE_KEY = process.env.MOBILE_CAPTURE_KEY || "leadcrm-mobile-capture-2024";

router.post("/whatsapp-capture", async (req, res) => {
  try {
    const { apiKey, phoneNumber, contactName, messagePreview } = req.body;
    if (apiKey !== CAPTURE_KEY) {
      return res.status(403).json({ error: "Invalid API key" });
    }
    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const normalized = phoneNumber.replace(/[^\d]/g, "");

    const lead = await prisma.lead.upsert({
      where: { phoneNumber: normalized },
      create: {
        phoneNumber: normalized,
        name: contactName || null,
        source: "WHATSAPP_MOBILE",
        whatsappProfileName: contactName || null,
      },
      update: {
        updatedAt: new Date(),
        ...(contactName && { whatsappProfileName: contactName }),
      },
    });

    await prisma.whatsAppLog.create({
      data: {
        leadId: lead.id,
        phoneNumber: normalized,
        contactName: contactName || null,
        messagePreview: messagePreview || null,
      },
    });

    res.json({ success: true, leadId: lead.id, isNew: lead.status === "NEW" });
  } catch (err) {
    console.error("whatsapp-capture error:", err);
    res.status(500).json({ error: "Failed to capture lead" });
  }
});

// GET /api/mobile/whatsapp-logs
// Returns recent WhatsApp notification captures for the logged-in user
router.get("/whatsapp-logs", requireAuth, async (req, res) => {
  const logs = await prisma.whatsAppLog.findMany({
    orderBy: { capturedAt: "desc" },
    take: 50,
    include: {
      lead: {
        select: { id: true, name: true, status: true, assignedStaffId: true },
      },
    },
  });
  res.json(logs);
});

// GET /api/mobile/leads/pipeline
// Returns leads grouped by status for the Kanban board
router.get("/leads/pipeline", requireAuth, async (req, res) => {
  const where = { deleted: false };
  if (req.user.role !== "ADMIN") {
    where.assignedStaffId = req.user.id;
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

  const pipeline = {
    NEW: [],
    CONTACTED: [],
    WAITING: [],
    SALE: [],
    FAILED: [],
  };

  for (const lead of leads) {
    if (pipeline[lead.status]) {
      pipeline[lead.status].push(lead);
    }
  }

  res.json(pipeline);
});

// GET /api/mobile/leads/:id/score
// AI lead scoring based on engagement signals
router.get("/leads/:id/score", requireAuth, async (req, res) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, deleted: false },
      include: {
        notes: true,
        followUps: true,
        messages: true,
      },
    });

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    let score = 0;

    // Message count (max 25 points)
    const msgCount = lead.messages.length;
    score += Math.min(msgCount * 5, 25);

    // Has follow-up scheduled (15 points)
    const activeFollowUps = lead.followUps.filter((f) => !f.completed);
    if (activeFollowUps.length > 0) score += 15;

    // Has notes (10 points)
    if (lead.notes.length > 0) score += 10;

    // Source is WhatsApp (10 points)
    if (lead.source === "WHATSAPP_MOBILE" || lead.source === "WHATSAPP_EXTENSION") {
      score += 10;
    }

    // Recent activity (max 20 points)
    const hoursSinceUpdate = (Date.now() - new Date(lead.updatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceUpdate < 24) score += 20;
    else if (hoursSinceUpdate < 72) score += 15;
    else if (hoursSinceUpdate < 168) score += 10;

    // Has a name set (5 points)
    if (lead.name && lead.name.trim()) score += 5;

    // Status progression (15 points)
    if (lead.status === "CONTACTED") score += 5;
    else if (lead.status === "WAITING") score += 10;
    else if (lead.status === "SALE") score += 15;

    // Clamp to 0-100
    score = Math.min(Math.max(score, 0), 100);

    // Grade
    let grade;
    if (score >= 70) grade = "HOT";
    else if (score >= 40) grade = "WARM";
    else grade = "COLD";

    // Persist to lead
    await prisma.lead.update({
      where: { id: lead.id },
      data: { aiScore: score, aiGrade: grade },
    });

    res.json({ score, grade, factors: { msgCount, hasFollowUp: activeFollowUps.length > 0, hasNotes: lead.notes.length > 0, source: lead.source, hoursSinceUpdate: Math.round(hoursSinceUpdate), hasName: !!lead.name, status: lead.status } });
  } catch (err) {
    console.error("score error:", err);
    res.status(500).json({ error: "Failed to compute score" });
  }
});

// POST /api/mobile/push/device-token
// Register an FCM device token for Android push notifications
router.post("/push/device-token", requireAuth, async (req, res) => {
  try {
    const { deviceToken, platform } = req.body;
    if (!deviceToken) return res.status(400).json({ error: "Device token is required" });

    await prisma.deviceToken.upsert({
      where: { userId_token: { userId: req.user.id, token: deviceToken } },
      create: {
        userId: req.user.id,
        token: deviceToken,
        platform: platform || "android",
      },
      update: { createdAt: new Date() },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("device-token error:", err);
    res.status(500).json({ error: "Failed to register device token" });
  }
});

// DELETE /api/mobile/push/device-token
router.delete("/push/device-token", requireAuth, async (req, res) => {
  try {
    const { deviceToken } = req.body;
    if (!deviceToken) return res.status(400).json({ error: "Device token is required" });

    await prisma.deviceToken.deleteMany({
      where: { userId: req.user.id, token: deviceToken },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("device-token delete error:", err);
    res.status(500).json({ error: "Failed to remove device token" });
  }
});

// GET /api/mobile/dashboard/stats
// Aggregated stats for the mobile dashboard
router.get("/dashboard/stats", requireAuth, async (req, res) => {
  try {
    const where = { deleted: false };
    if (req.user.role !== "ADMIN") {
      where.assignedStaffId = req.user.id;
    }

    const [total, newCount, contacted, waiting, sale, failed] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: "NEW" } }),
      prisma.lead.count({ where: { ...where, status: "CONTACTED" } }),
      prisma.lead.count({ where: { ...where, status: "WAITING" } }),
      prisma.lead.count({ where: { ...where, status: "SALE" } }),
      prisma.lead.count({ where: { ...where, status: "FAILED" } }),
    ]);

    const upcomingFollowUps = await prisma.followUp.findMany({
      where: {
        completed: false,
        scheduledAt: { gte: new Date() },
        ...(req.user.role !== "ADMIN" ? { staffId: req.user.id } : {}),
      },
      include: { lead: { select: { id: true, name: true, phoneNumber: true, status: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 5,
    });

    res.json({ total, newCount, contacted, waiting, sale, failed, upcomingFollowUps });
  } catch (err) {
    console.error("dashboard stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// GET /api/mobile/reminders/smart
// Smart suggestions for the dashboard
router.get("/reminders/smart", requireAuth, async (req, res) => {
  try {
    const where = { deleted: false };
    if (req.user.role !== "ADMIN") {
      where.assignedStaffId = req.user.id;
    }

    const suggestions = [];

    // Leads with status NEW and no activity in 48h
    const staleNew = await prisma.lead.findMany({
      where: {
        ...where,
        status: "NEW",
        updatedAt: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
      take: 5,
    });
    for (const lead of staleNew) {
      suggestions.push({
        type: "CONTACT_NOW",
        leadId: lead.id,
        leadName: lead.name || lead.phoneNumber,
        message: `${lead.name || lead.phoneNumber} has been waiting for 48+ hours`,
      });
    }

    // Leads with status CONTACTED and no follow-up
    const noFollowUp = await prisma.lead.findMany({
      where: {
        ...where,
        status: "CONTACTED",
        followUps: { none: {} },
      },
      take: 5,
    });
    for (const lead of noFollowUp) {
      suggestions.push({
        type: "SCHEDULE_FOLLOWUP",
        leadId: lead.id,
        leadName: lead.name || lead.phoneNumber,
        message: `${lead.name || lead.phoneNumber} has no follow-up scheduled`,
      });
    }

    // Leads with overdue follow-ups
    const overdue = await prisma.followUp.findMany({
      where: {
        completed: false,
        scheduledAt: { lt: new Date() },
        ...(req.user.role !== "ADMIN" ? { staffId: req.user.id } : {}),
      },
      include: { lead: { select: { id: true, name: true, phoneNumber: true } } },
      take: 5,
    });
    for (const fu of overdue) {
      suggestions.push({
        type: "OVERDUE_FOLLOWUP",
        leadId: fu.lead.id,
        leadName: fu.lead.name || fu.lead.phoneNumber,
        message: `Follow-up with ${fu.lead.name || fu.lead.phoneNumber} was due ${new Date(fu.scheduledAt).toLocaleDateString()}`,
      });
    }

    res.json(suggestions.slice(0, 10));
  } catch (err) {
    console.error("smart reminders error:", err);
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

export default router;
