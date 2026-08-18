import { hashUserData } from "../lib/meta-crypto.js";

const API_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com/" + API_VERSION;

const STATUS_TO_EVENT = {
  NEW: "Lead",
  CONTACTED: "LeadQualified",
  WAITING: "LeadQualified",
  SALE: "LeadConverted",
  FAILED: null,
};

export function getEventNameForStatus(status) {
  return STATUS_TO_EVENT[status] || null;
}

export async function sendConversionEvent({ pixelId, accessToken, eventName, lead, metaLeadId, eventTime, partnerAgent }) {
  const hashed = hashUserData({
    email: lead.email || null,
    phone: lead.phoneNumber || null,
    firstName: lead.name?.split(" ")[0] || null,
    lastName: lead.name?.split(" ").slice(1).join(" ") || null,
  });

  const serverEvent = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    action_source: "system_generated",
    event_source: "crm",
    user_data: {
      ...hashed,
    },
    custom_data: {
      lead_event_source: "LeadCRM",
    },
  };

  if (metaLeadId) {
    serverEvent.user_data.lead_id = metaLeadId;
  }

  if (partnerAgent) {
    serverEvent.custom_data.partner_agent = partnerAgent;
  }

  const url = GRAPH_BASE + "/" + pixelId + "/events?access_token=" + accessToken;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [serverEvent] }),
  });

  const result = await res.json();
  if (!res.ok) {
    console.error("Conversion API error:", result);
    throw new Error("Failed to send conversion event");
  }
  return result;
}

export async function sendBatchConversionEvents({ pixelId, accessToken, events, partnerAgent }) {
  const serverEvents = events.map((evt) => {
    const hashed = hashUserData({
      email: evt.lead.email || null,
      phone: evt.lead.phoneNumber || null,
      firstName: evt.lead.name?.split(" ")[0] || null,
      lastName: evt.lead.name?.split(" ").slice(1).join(" ") || null,
    });

    const serverEvent = {
      event_name: evt.eventName,
      event_time: evt.eventTime || Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      event_source: "crm",
      user_data: { ...hashed },
      custom_data: { lead_event_source: "LeadCRM" },
    };

    if (evt.metaLeadId) serverEvent.user_data.lead_id = evt.metaLeadId;
    if (partnerAgent) serverEvent.custom_data.partner_agent = partnerAgent;

    return serverEvent;
  });

  const url = GRAPH_BASE + "/" + pixelId + "/events?access_token=" + accessToken;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: serverEvents }),
  });

  return res.json();
}
