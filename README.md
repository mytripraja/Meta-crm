# LeadCRM Backend

Express + PostgreSQL (Prisma) API. Handles auth, leads, notes, and follow-up
reminders.

**Current WhatsApp setup:** your customer uses the free WhatsApp Business
app, which has no official API. So for now, leads enter the CRM two ways:
1. Manual quick-add (staff types the number into the CRM)
2. The `leadcrm-whatsapp-extension` browser extension (staff clicks "Save to
   CRM" on web.whatsapp.com)

The `whatsapp.routes.js` / `whatsapp.service.js` files implement a Cloud API
webhook for **fully automatic** capture. They're inactive until you fill in
the WhatsApp env vars below — kept in the codebase so that if the business
later verifies for the paid Cloud API, auto-capture switches on with no
other changes needed anywhere else in the CRM.

## Setup

```bash
npm install
cp .env.example .env
# fill in .env with your real values (see below)

npx prisma migrate dev --name init
npx prisma db seed        # creates your first admin login

npm run dev                # local dev, http://localhost:4000
```

## .env values you need

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Your Postgres connection string (Render/Supabase/Neon) |
| `JWT_SECRET` | Any long random string |
| `WHATSAPP_TOKEN` | Meta developer console → your app → WhatsApp → API setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Same screen, "Phone number ID" |
| `WHATSAPP_VERIFY_TOKEN` | Any string you make up — enter the SAME string in Meta's webhook config |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Run `npx web-push generate-vapid-keys` |

## Connecting the WhatsApp webhook

1. Deploy this backend (e.g. to Render) so you have a public HTTPS URL.
2. In Meta Developer Console → your app → WhatsApp → Configuration:
   - Callback URL: `https://your-backend-url.com/api/whatsapp/webhook`
   - Verify token: same value as `WHATSAPP_VERIFY_TOKEN` in your `.env`
3. Subscribe to the `messages` webhook field.
4. Send a test WhatsApp message to your business number — it should appear
   in the CRM within a few seconds as a new lead.

## Notes on the reminder system

A cron job checks every minute for follow-ups where "now" has reached
`scheduledAt - remindBeforeMinutes`. When it fires, it sends a browser push
notification to the assigned staff member (not to all staff), then marks
the follow-up as notified so it won't repeat.

Push notifications require the staff member to have opened the CRM in their
browser at least once and accepted the "allow notifications" prompt — this
happens automatically after login on the frontend.
