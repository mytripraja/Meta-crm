import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

// All routes below require login; most require admin
router.use(requireAuth);

// GET /api/users - list all staff/admins (any logged-in user, needed for assignment dropdown)
router.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

// POST /api/users - create new staff/admin (admin only)
router.post("/", requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required" });
  }
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(409).json({ error: "A user with this email already exists" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: role === "ADMIN" ? "ADMIN" : "STAFF",
    },
  });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// PATCH /api/users/:id - update role / active status (admin only)
router.patch("/:id", requireAdmin, async (req, res) => {
  const { role, active, name } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(role && { role }),
      ...(typeof active === "boolean" && { active }),
      ...(name && { name }),
    },
  });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });
});

// DELETE /api/users/:id - deactivate a staff account (admin only). We deactivate rather than
// hard-delete so past notes/follow-ups made by that staff member stay intact.
router.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ success: true });
});

export default router;
