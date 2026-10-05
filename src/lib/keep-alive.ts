/**
 * Pings the health endpoint every 5 minutes to prevent Railway container sleep
 */
export function startKeepAlive() {
  const appUrl = process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

  if (!appUrl) {
    console.log("Keep-alive: no APP_URL set, skipping");
    return;
  }

  console.log(`🏓 Keep-alive started → ${appUrl}/api/health every 5 min`);

  setInterval(async () => {
    try {
      const res = await fetch(`${appUrl}/api/health`);
      console.log(`🏓 Keep-alive ping OK (${res.status})`);
    } catch (err) {
      console.warn("🏓 Keep-alive ping failed:", err);
    }
  }, 5 * 60 * 1000); // every 5 minutes
}
