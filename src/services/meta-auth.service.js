const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function getFacebookLoginUrl(clientId, redirectUri, state) {
  const scopes = [
    "pages_read_engagement",
    "pages_manage_metadata",
    "pages_show_list",
    "ads_management",
    "ads_read",
    "leads_retrieval",
    "instagram_basic",
    "instagram_manage_messages",
    "pages_messaging",
  ].join(",");

  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scopes}&response_type=code`;
}

export async function exchangeCodeForToken(code, clientId, clientSecret, redirectUri) {
  const url = `${GRAPH_BASE}/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function getLongLivedToken(shortLivedToken, clientId, clientSecret) {
  const url = `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${shortLivedToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Long-lived token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function getPageList(userAccessToken) {
  const url = `${GRAPH_BASE}/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token,category`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch pages: ${await res.text()}`);
  return res.json();
}

export async function subscribePageToWebhooks(pageId, pageAccessToken, callbackUrl) {
  const url = `${GRAPH_BASE}/${pageId}/subscribed_apps`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscribed_fields: "leadgen,messages,messaging_postbacks,messaging_seen",
      access_token: pageAccessToken,
    }),
  });
  if (!res.ok) throw new Error(`Failed to subscribe page: ${await res.text()}`);
  return res.json();
}

export async function verifyToken(accessToken) {
  const url = `${GRAPH_BASE}/me?access_token=${accessToken}&fields=id,name`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}
