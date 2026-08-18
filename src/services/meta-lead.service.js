const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export async function fetchLeadById(leadId, accessToken) {
  const url = `${GRAPH_BASE}/${leadId}?access_token=${accessToken}&fields=id,created_time,form_id,ad_id,adgroup_id,campaign_id,field_data,partner_name`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch lead ${leadId}: ${await res.text()}`);
  return res.json();
}

export async function fetchFormLeads(formId, accessToken, since) {
  let url = `${GRAPH_BASE}/${formId}/leads?access_token=${accessToken}&fields=id,created_time,form_id,ad_id,field_data&limit=100`;
  if (since) url += `&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":${since}}]`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch form leads: ${await res.text()}`);
  return res.json();
}

export async function fetchAdLeads(adId, accessToken, since) {
  let url = `${GRAPH_BASE}/${adId}/leads?access_token=${accessToken}&fields=id,created_time,form_id,field_data&limit=100`;
  if (since) url += `&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":${since}}]`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ad leads: ${await res.text()}`);
  return res.json();
}

export function parseLeadFieldData(fieldData) {
  const result = { name: "", email: "", phone: "", company: "", custom: {} };
  if (!fieldData || !Array.isArray(fieldData)) return result;

  for (const field of fieldData) {
    const values = field.values || [];
    const value = values[0] || "";
    const name = (field.name || "").toLowerCase();

    if (name === "full_name" || name === "first_name" || name === "name") {
      result.name = value;
    } else if (name === "email") {
      result.email = value;
    } else if (name === "phone_number" || name === "phone" || name === "mobile_phone_number") {
      result.phone = value.replace(/[^\d]/g, "");
    } else if (name === "company_name" || name === "company") {
      result.company = value;
    } else {
      result.custom[field.name] = value;
    }
  }

  return result;
}

export async function fetchPageForms(pageId, accessToken) {
  const url = `${GRAPH_BASE}/${pageId}/leadgen_forms?access_token=${accessToken}&fields=id,name,status`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch forms: ${await res.text()}`);
  return res.json();
}
