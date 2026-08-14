import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// GET /api/whatsapp/webhook - Meta calls this once to verify your webhook URL
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST /api/whatsapp/webhook - Meta calls this on every inbound message/status update
router.post("/webhook", async (req, res) => {
  // Always ack fast so Meta doesn't retry/backoff on us
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) return; // status update, not a new message

    for (const msg of messages) {
      const phoneNumber = msg.from; // e.g. "9198xxxxxxx"
      const profileName = value.contacts?.[0]?.profile?.name || null;
      const text =
        msg.text?.body ||
        (msg.type ? `[${msg.type} message]` : "[message]");

      // Find or auto-create the lead
      let lead = await prisma.lead.findUnique({ where: { phoneNumber } });
      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            phoneNumber,
            whatsappProfileName: profileName,
            status: "NEW",
          },
        });
      } else {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { updatedAt: new Date(), status: lead.status === "NEW" ? "NEW" : lead.status },
        });
      }

      await prisma.message.create({
        data: { leadId: lead.id, direction: "in", content: text },
      });
    }
  } catch (err) {
    console.error("Error processing WhatsApp webhook:", err);
  }
});

export default router;
