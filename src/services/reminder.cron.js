import cron from "node-cron";
import prisma from "../lib/prisma.js";
import { sendPushToUser } from "./push.service.js";

// Runs every minute. For each pending follow-up, checks whether "now" has reached
// (scheduledAt - remindBeforeMinutes). If so, sends the push notification once
// and marks it notified so it never fires twice.
export function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 60 * 1000); // look ahead up to 1hr max lead time

    const dueSoon = await prisma.followUp.findMany({
      where: { notified: false, completed: false, scheduledAt: { lte: soon } },
      include: { lead: true },
    });

    for (const f of dueSoon) {
      const remindAt = new Date(f.scheduledAt.getTime() - f.remindBeforeMinutes * 60 * 1000);
      if (now >= remindAt) {
        const name = f.lead.name || f.lead.whatsappProfileName || f.lead.phoneNumber;
        await sendPushToUser(f.staffId, {
          title: "Follow-up reminder",
          body: `Call ${name} at ${f.scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
          leadId: f.leadId,
        });
        await prisma.followUp.update({ where: { id: f.id }, data: { notified: true } });
      }
    }
  });
  console.log("Reminder cron started (checks every minute)");
}
