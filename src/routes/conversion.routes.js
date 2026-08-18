import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { sendConversionEvent } from "../services/meta-conversion.service.js";

const router = Router();
router.use(requireAuth);

// GET /api/conversion/config - Get current config
router.get("/config", async (req, res) => {
  const configs = await prisma.metaConversionConfig.findMany({
    include: { integration: { select: { pageId: true, pageName: true } } },
  });
  res.json(configs);
});

// POST /api/conversion/config - Create/update config
router.post("/config", async (req, res) => {
  const { integrationId, pixelId, accessToken, partnerAgent } = req.body;
  if (!integrationId || !pixelId || !accessToken) {
    return res.status(400).json({ error: "integrationId, pixelId, and accessToken are required" });
  }

  const config = await prisma.metaConversionConfig.upsert({
    where: { id: integrationId },
    create: {
      integrationId,
      pixelId,
      accessToken,
      partnerAgent: partnerAgent || "LeadCRM",
      isActive: true,
    },
    update: {
      pixelId,
      accessToken,
      partnerAgent: partnerAgent || "LeadCRM",
    },
  });

  res.json(config);
});

// POST /api/conversion/test - Send test event
router.post("/test", async (req, res) => {
  try {
    const { pixelId, accessToken, testEmail, testPhone } = req.body;
    if (!pixelId || !accessToken) {
      return res.status(400).json({ error: "pixelId and accessToken are required" });
    }

    const result = await sendConversionEvent({
      pixelId,
      accessToken,
      eventName: "Lead",
      lead: {
        name: "Test Lead",
        phoneNumber: testPhone || "919999999999",
        email: testEmail || "test@example.com",
      },
      eventTime: Math.floor(Date.now() / 1000),
      partnerAgent: "LeadCRM",
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error("Conversion test error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversion/dashboard - Conversion stats
router.get("/dashboard", async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: { deleted: false },
    select: { status: true, source: true, createdAt: true },
  });

  const stats = {
    total: leads.length,
    byStatus: { NEW: 0, CONTACTED: 0, WAITING: 0, SALE: 0, FAILED: 0 },
    bySource: {},
    convertedThisMonth: 0,
    conversionRate: 0,
  };

  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);

  for (const lead of leads) {
    stats.byStatus[lead.status] = (stats.byStatus[lead.status] || 0) + 1;
    stats.bySource[lead.source || "UNKNOWN"] = (stats.bySource[lead.source || "UNKNOWN"] || 0) + 1;

    if (lead.status === "SALE" && lead.createdAt >= thisMonth) {
      stats.convertedThisMonth++;
    }
  }

  stats.conversionRate = stats.total > 0 ? Math.round((stats.byStatus.SALE / stats.total) * 100) : 0;

  res.json(stats);
});

export default router;
