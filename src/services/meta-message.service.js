const API_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com/" + API_VERSION;

export async function sendMessengerReply(pageId, pageAccessToken, recipientId, text) {
  const url = GRAPH_BASE + "/" + pageId + "/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      access_token: pageAccessToken,
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    console.error("Messenger send failed:", result);
    throw new Error("Failed to send Messenger reply");
  }
  return result;
}

export async function sendInstagramReply(pageId, pageAccessToken, recipientIgsid, text) {
  const url = GRAPH_BASE + "/" + pageId + "/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { text },
      access_token: pageAccessToken,
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    console.error("Instagram send failed:", result);
    throw new Error("Failed to send Instagram reply");
  }
  return result;
}

export async function sendMediaMessage(pageId, pageAccessToken, recipientId, mediaUrl, mediaType) {
  const url = GRAPH_BASE + "/" + pageId + "/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: mediaType.toUpperCase(),
          payload: { url: mediaUrl },
        },
      },
      access_token: pageAccessToken,
    }),
  });

  return res.json();
}

export async function markSeen(pageId, pageAccessToken, recipientId) {
  const url = GRAPH_BASE + "/" + pageId + "/messages";
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: "mark_seen",
      access_token: pageAccessToken,
    }),
  });
}

export async function typingOn(pageId, pageAccessToken, recipientId) {
  const url = GRAPH_BASE + "/" + pageId + "/messages";
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: "typing_on",
      access_token: pageAccessToken,
    }),
  });
}
