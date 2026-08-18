import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/inbox/conversations - List all conversations
router.get("/conversations", async (req, res) => {
  const { platform, search } = req.query;

  const where = { isActive: true };
  if (platform) where.platform = platform;

  if (search) {
    where.lead = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phoneNumber: { contains: search } },
      ],
    };
  }

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      lead: {
        select: { id: true, name: true, phoneNumber: true, status: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  res.json(conversations);
});

// GET /api/inbox/conversations/:id/messages - Get messages
router.get("/conversations/:id/messages", async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      lead: {
        select: { id: true, name: true, phoneNumber: true, status: true },
      },
    },
  });

  if (!conversation) return res.status(404).json({ error: "Conversation not found" });

  const messages = await prisma.inboxMessage.findMany({
    where: { conversationId: req.params.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.conversation.update({
    where: { id: req.params.id },
    data: { unreadCount: 0 },
  });

  res.json({ conversation, messages });
});

// POST /api/inbox/conversations/:id/read - Mark as read
router.patch("/conversations/:id/read", async (req, res) => {
  await prisma.conversation.update({
    where: { id: req.params.id },
    data: { unreadCount: 0 },
  });
  res.json({ success: true });
});

// GET /api/inbox/stats - Conversation stats
router.get("/stats", async (req, res) => {
  const [total, unread, whatsapp, messenger, instagram] = await Promise.all([
    prisma.conversation.count({ where: { isActive: true } }),
    prisma.conversation.aggregate({ where: { isActive: true }, _sum: { unreadCount: true } }),
    prisma.conversation.count({ where: { isActive: true, platform: "whatsapp" } }),
    prisma.conversation.count({ where: { isActive: true, platform: "messenger" } }),
    prisma.conversation.count({ where: { isActive: true, platform: "instagram" } }),
  ]);

  res.json({
    total,
    unreadTotal: unread._sum.unreadCount || 0,
    byPlatform: { whatsapp, messenger, instagram },
  });
});

// DELETE /api/inbox/conversations/:id - Archive conversation
router.delete("/conversations/:id", async (req, res) => {
  await prisma.conversation.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true });
});

export default router;
