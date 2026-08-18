import prisma from "../lib/prisma.js";
import { sendConversionEvent, getEventNameForStatus } from "./meta-conversion.service.js";

export async function trackLeadStageChange(leadId, newStatus, oldStatus) {
  if (newStatus === oldStatus) return;
  if (newStatus === "FAILED") return;

  const eventName = getEventNameForStatus(newStatus);
  if (!eventName) return;

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const integrations = await prisma.metaIntegration.findMany({
      where: { isActive: true },
      include: { conversions: { where: { isActive: true }, take: 1 } },
    });

    for (const integration of integrations) {
      const config = integration.conversions[0];
      if (!config) continue;

      await sendConversionEvent({
        pixelId: config.pixelId,
        accessToken: config.accessToken,
        eventName,
        lead: {
          name: lead.name,
          phoneNumber: lead.phoneNumber,
          email: null,
        },
        metaLeadId: lead.metaLeadId || null,
        eventTime: Math.floor(Date.now() / 1000),
        partnerAgent: config.partnerAgent || "LeadCRM",
      }).catch((err) => {
        console.error("Conversion API track error:", err.message);
      });
    }
  } catch (err) {
    console.error("Lead stage tracker error:", err.message);
  }
}
