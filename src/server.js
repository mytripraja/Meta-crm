import "dotenv/config";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/users.routes.js";
import leadRoutes from "./routes/leads.routes.js";
import noteRoutes from "./routes/notes.routes.js";
import followUpRoutes from "./routes/followups.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import pushRoutes from "./routes/push.routes.js";
import { startReminderCron } from "./services/reminder.cron.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/leads", noteRoutes);      // adds POST /api/leads/:leadId/notes
app.use("/api/leads", followUpRoutes);  // adds /:leadId/followups + /followups/*
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/push", pushRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`LeadCRM backend running on port ${PORT}`);
  startReminderCron();
});
