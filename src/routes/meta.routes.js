import { Router } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import {
  getFacebookLoginUrl,
  exchangeCodeForToken,
  getLongLivedToken,
  getPageList,
  subscribePageToWebhooks,
  verifyToken,
} from "../services/meta-auth.service.js";
import { fetchLeadById, parseLeadFieldData, fetchPageForms } from "../services/meta-lead.service.js";
import { sendMessengerReply, sendInstagramReply } from "../services/meta-message.service.js";

const router = Router();

// ====== META WEBHOOK VERIFICATION ======
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ====== META WEBHOOK EVENTS (Lead Ads + Messenger + Instagram) ======
router.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "page" && body.object !== "instagram") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const field = change.field;
        const value = change.value;

        if (field === "leadgen") {
          await handleLeadgenEvent(value);
        } else if (field === "messages") {
          await handleMessagingEvent(value, entry.id, "messenger");
        } else if (field === "messages" && body.object === "instagram") {
          await handleMessagingEvent(value, entry.id, "instagram");
        }
      }
    }
  } catch (err) {
    console.error("Meta webhook error:", err);
  }
});

async function handleLeadgenEvent(value) {
  const { leadgen_id, page_id, form_id, ad_id } = value;

  const integration = await prisma.metaIntegration.findFirst({
    where: { pageId: String(page_id), isActive: true },
  });
  if (!integration) {
    console.error("No integration found for page:", page_id);
    return;
  }

  const leadData = await fetchLeadById(leadgen_id, integration.accessToken);
  const parsed = parseLeadFieldData(leadData.field_data);

  const normalizedPhone = parsed.phone.replace(/[^\d]/g, "");

  let lead = null;
  if (normalizedPhone) {
    lead = await prisma.lead.findUnique({ where: { phoneNumber: normalizedPhone } });
  }

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        phoneNumber: normalizedPhone || "unknown_" + leadgen_id,
        name: parsed.name || null,
        source: "META_LEAD_ADS",
        metaLeadId: String(leadgen_id),
        metaFormId: form_id ? String(form_id) : null,
        metaAdId: ad_id ? String(ad_id) : null,
      },
    });
  } else {
    lead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        metaLeadId: lead.metaLeadId || String(leadgen_id),
        metaFormId: lead.metaFormId || (form_id ? String(form_id) : null),
        metaAdId: lead.metaAdId || (ad_id ? String(ad_id) : null),
        source: lead.source || "META_LEAD_ADS",
        name: lead.name || parsed.name || null,
        updatedAt: new Date(),
      },
    });
  }

  if (parsed.email && !lead.notes?.length) {
    await prisma.note.create({
      data: {
        leadId: lead.id,
        staffId: integration.userId,
        content: "Email from Meta Lead Ad: " + parsed.email,
      },
    }).catch(() => {});
  }

  console.log("Meta lead captured:", lead.id, parsed.name || normalizedPhone);
}

async function handleMessagingEvent(value, pageId, platform) {
  const messages = value.messages || [];
  const messagingPostbacks = value.messaging_postbacks || [];

  for (const msg of messages) {
    if (msg.is_echo) continue;

    const senderId = msg.sender?.id;
    const text = msg.text || "";
    const mid = msg.mid || "";

    if (!senderId || !text) continue;

    const integration = await prisma.metaIntegration.findFirst({
      where: { pageId: String(pageId), isActive: true },
    });
    if (!integration) continue;

    let conversation = await prisma.conversation.findFirst({
      where: { platformConversationId: senderId, platform },
    });

    let lead = null;
    if (conversation?.leadId) {
      lead = await prisma.lead.findUnique({ where: { id: conversation.leadId } });
    }

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          phoneNumber: "meta_" + senderId,
          name: null,
          source: platform === "instagram" ? "INSTAGRAM_DM" : "FACEBOOK_MESSENGER",
        },
      });
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          leadId: lead.id,
          platform,
          platformConversationId: senderId,
          lastMessageAt: new Date(),
        },
      });
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
      });
    }

    await prisma.inboxMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "in",
        content: text,
        platformMessageId: mid,
      },
    });
  }
}

// ====== OAUTH FLOW ======
router.get("/oauth/login", requireAuth, (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = (process.env.BACKEND_URL || req.headers.origin) + "/api/meta/oauth/callback";

  req.session = req.session || {};
  req.session.metaOAuthState = state;
  req.session.metaOAuthUserId = req.user.id;

  const url = getFacebookLoginUrl(process.env.META_APP_ID, redirectUri, state);
  res.redirect(url);
});

router.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query;

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  try {
    if (!code) return res.redirect(frontendUrl + "/integrations?error=no_code");

    const redirectUri = (process.env.BACKEND_URL || req.headers.origin) + "/api/meta/oauth/callback";
    const clientId = process.env.META_APP_ID;
    const clientSecret = process.env.META_APP_SECRET;

    const tokenRes = await exchangeCodeForToken(code, clientId, clientSecret, redirectUri);
    const longLived = await getLongLivedToken(tokenRes.access_token, clientId, clientSecret);

    const pages = await getPageList(longLived.access_token);

    for (const page of pages.data || []) {
      await prisma.metaIntegration.upsert({
        where: { pageId: page.id },
        create: {
          userId: "admin",
          pageId: page.id,
          pageName: page.name,
          accessToken: page.access_token || longLived.access_token,
        },
        update: {
          pageName: page.name,
          accessToken: page.access_token || longLived.access_token,
          isActive: true,
        },
      });
    }

    res.redirect(frontendUrl + "/integrations?success=connected");
  } catch (err) {
    console.error("Meta OAuth callback error:", err);
    res.redirect(frontendUrl + "/integrations?error=token_exchange_failed");
  }
});

// ====== CONNECT WITH EXISTING TOKEN ======
router.post("/connect", requireAuth, async (req, res) => {
  try {
    const { pageAccessToken, pageId } = req.body;
    if (!pageAccessToken) return res.status(400).json({ error: "Page access token is required" });

    const me = await verifyToken(pageAccessToken);
    if (!me) return res.status(400).json({ error: "Invalid access token" });

    const actualPageId = pageId || me.id;
    const pageName = me.name || "Facebook Page";

    await prisma.metaIntegration.upsert({
      where: { pageId: actualPageId },
      create: {
        userId: req.user.id,
        pageId: actualPageId,
        pageName,
        accessToken: pageAccessToken,
      },
      update: {
        pageName,
        accessToken: pageAccessToken,
        isActive: true,
      },
    });

    res.json({ success: true, pageId: actualPageId, pageName });
  } catch (err) {
    console.error("Meta connect error:", err);
    res.status(500).json({ error: "Failed to connect" });
  }
});

// ====== LIST CONNECTED PAGES ======
router.get("/pages", requireAuth, async (req, res) => {
  const pages = await prisma.metaIntegration.findMany({
    where: { isActive: true },
    select: {
      id: true,
      pageId: true,
      pageName: true,
      createdAt: true,
      conversions: { select: { pixelId: true, isActive: true } },
    },
  });
  res.json(pages);
});

// ====== DISCONNECT PAGE ======
router.delete("/pages/:id", requireAuth, async (req, res) => {
  await prisma.metaIntegration.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true });
});

// ====== SEND REPLY ======
router.post("/reply", requireAuth, async (req, res) => {
  try {
    const { conversationId, text } = req.body;
    if (!conversationId || !text?.trim()) {
      return res.status(400).json({ error: "Conversation ID and text are required" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const integration = await prisma.metaIntegration.findFirst({
      where: { isActive: true },
    });
    if (!integration) return res.status(400).json({ error: "No Meta integration connected" });

    const recipientId = conversation.platformConversationId;

    if (conversation.platform === "instagram") {
      await sendInstagramReply(integration.pageId, integration.accessToken, recipientId, text.trim());
    } else {
      await sendMessengerReply(integration.pageId, integration.accessToken, recipientId, text.trim());
    }

    await prisma.inboxMessage.create({
      data: {
        conversationId,
        direction: "out",
        content: text.trim(),
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Reply error:", err);
    res.status(500).json({ error: "Failed to send reply" });
  }
});

// ====== FETCH PAGE FORMS ======
router.get("/pages/:pageId/forms", requireAuth, async (req, res) => {
  try {
    const integration = await prisma.metaIntegration.findFirst({
      where: { pageId: req.params.pageId, isActive: true },
    });
    if (!integration) return res.status(404).json({ error: "Page not found" });

    const forms = await fetchPageForms(req.params.pageId, integration.accessToken);
    res.json(forms.data || []);
  } catch (err) {
    console.error("Fetch forms error:", err);
    res.status(500).json({ error: "Failed to fetch forms" });
  }
});

export default router;
