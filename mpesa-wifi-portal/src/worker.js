// --- HELPERS ---
async function getAccessToken(env) {
  const auth = btoa(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`);
  const resp = await fetch("https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
    headers: { "Authorization": `Basic ${auth}` }
  });
  const data = await resp.json();
  return data.access_token;
}

/**
 * Sanitizes phone numbers to 254XXXXXXXXX format
 */
function cleanPhoneNumber(phone) {
  let cleaned = phone.replace(/\s+/g, '').replace('+', '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if ((cleaned.startsWith('7') || cleaned.startsWith('1')) && cleaned.length === 9) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

async function generateRhid(token, faskey) {
  if (!token) return null;
  const encoder = new TextEncoder();
  const routerKey = faskey.trim() + "\n"; 
  const data = encoder.encode(token.trim() + routerKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}


// Helper to format auth entry with dynamically computed remaining time
function formatAuthEntry(r) {
  const up = r.upload_rate || 0;
  const down = r.download_rate || 0;
  
  // Calculate remaining minutes dynamically from the expiry timestamp
  const nowMs = Date.now();
  const expiryMs = r.expiry_ms || nowMs;
  const remainingMins = Math.max(1, Math.round((expiryMs - nowMs) / 60000));

  const ip = r.client_ip || "0.0.0.0";
  return `* ${r.rhid} ${remainingMins} ${up} ${down} 0 0 ${r.mac_address} ${ip}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// --- HELPER FUNCTIONS ---
async function cleanupExpiredSessions(db) {
  try {
    await db.prepare("DELETE FROM active_payments WHERE session_expiry <= datetime('now')").run();
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}

export default {
  // Scheduled trigger execution to purge expired records from active_payments
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupExpiredSessions(env.DB));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- 1. AUTHMON POLLING ---
    const authGet = url.searchParams.get("auth_get");
    if (authGet !== null) {
      const payload = url.searchParams.get("payload") || "";
      const gateway = url.searchParams.get("gateway") || "bhscyber"; 

      // Handle Token Acknowledgements from openNDS
      if (payload.startsWith("*") && payload.length > 1) {
        const tokensToAck = payload.replace(/\*/g, "").trim().split(/\s+/).filter(t => t.length > 0);
        
        if (tokensToAck.length > 0) {
          const placeholders = tokensToAck.map(() => "?").join(",");
          
          // Batch execution to reduce DB round-trips
          await env.DB.batch([
            env.DB.prepare(`UPDATE payments SET processed = 1 WHERE rhid IN (${placeholders})`).bind(...tokensToAck),
            env.DB.prepare(`DELETE FROM active_payments WHERE rhid IN (${placeholders})`).bind(...tokensToAck)
          ]);
        }
        
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(cleanupExpiredSessions(env.DB));
        }
        return new Response("ACK_OK\n", { headers: { "Content-Type": "text/plain" } });
      }

      // OPTIMIZED QUERY: Removed LEFT JOIN packages by reading upload_rate/download_rate directly
      const query = `
        SELECT 
          ap.rhid, 
          CAST((julianday(ap.session_expiry) - 2440587.5) * 86400000 AS INTEGER) AS expiry_ms, 
          ap.mac_address, 
          s.client_ip, 
          ap.upload_rate, 
          ap.download_rate 
        FROM active_payments ap
        LEFT JOIN client_sessions s ON ap.mac_address = s.mac_address
        WHERE ap.processed = 0 
          AND ap.session_expiry > datetime('now') 
          AND ap.gateway_hash = ? 
          AND ap.rhid IS NOT NULL`;

      const { results } = await env.DB.prepare(query).bind(gateway).all();
      const activeClients = results || [];

      if (activeClients.length === 0) {
        return new Response("*\n", { headers: { "Content-Type": "text/plain" } });
      }

      const nowMs = Date.now();
      const validClients = activeClients.filter(r => r.expiry_ms > nowMs);

      if (validClients.length > 0) {
        const responseText = validClients.map(formatAuthEntry).join("\n") + "\n";
        return new Response(responseText, { headers: { "Content-Type": "text/plain" } });
      }

      return new Response("*\n", { headers: { "Content-Type": "text/plain" } });
    }

    // --- 2. FAS HANDSHAKE ---
    const fasBlob = url.searchParams.get("fas");
    if (fasBlob) {
      try {
        const decoded = atob(fasBlob.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/"));
        const params = new URLSearchParams(decoded.replace(/, /g, "&"));
        const clientmac = params.get("clientmac") || "";
        const token = params.get("hid") || "";
        const gatewayHash = params.get("gatewayname") || "";
        const clientip = params.get("clientip") || "";
        const clientif = params.get("clientif") || "";

        const { results: pkgs } = await env.DB.prepare(
          "SELECT * FROM packages ORDER BY amount ASC"
        ).all();

        if (clientmac) {
          await env.DB.prepare(`
            INSERT INTO client_sessions (mac_address, token, gateway_hash, client_ip, client_if) 
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(mac_address) DO UPDATE SET 
              token = excluded.token, 
              gateway_hash = excluded.gateway_hash,
              client_ip = excluded.client_ip,
              client_if = excluded.client_if,
              created_at = CURRENT_TIMESTAMP
          `).bind(clientmac, token, gatewayHash, clientip, clientif).run();
        }

        return new Response(generateLoginHTML(clientmac, clientip, pkgs || []), { 
          headers: { "Content-Type": "text/html; charset=utf-8" } 
        });
      } catch (e) {
        return new Response("FAS Error", { status: 400 });
      }
    }

    // --- 3. SESSION RECONNECT ---
    if (url.pathname === "/reconnect") {
      const mac = url.searchParams.get("mac");
      if (!mac) {
        return Response.json({ success: false, error: "MAC address required" }, { status: 400, headers: corsHeaders });
      }

      const activePay = await env.DB.prepare(`
        SELECT id, checkout_id, amount, duration_minutes, gateway_hash 
        FROM payments 
        WHERE mac_address = ? 
          AND status = 'PAID' 
          AND session_expiry > datetime('now')
        ORDER BY created_at DESC 
        LIMIT 1
      `).bind(mac).first();

      if (!activePay) {
        return Response.json({ success: false, error: "No active session found for this device." }, { status: 404, headers: corsHeaders });
      }

      const sessRow = await env.DB.prepare("SELECT id, token FROM client_sessions WHERE mac_address = ?").bind(mac).first();
      
      if (!sessRow) {
        return Response.json({ success: false, error: "Session missing. Please reconnect to the Wi-Fi network." }, { status: 400, headers: corsHeaders });
      }

      const rhid = await generateRhid(sessRow.token, env.FAS_KEY);

      // Execute updates and insertions in a single DB batch
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE payments 
          SET processed = 0, session_id = ?, rhid = ? 
          WHERE id = ?
        `).bind(sessRow.id, rhid, activePay.id),
        
        env.DB.prepare("UPDATE client_sessions SET rhid = ? WHERE id = ?").bind(rhid, sessRow.id),

        env.DB.prepare(`
          INSERT INTO active_payments (payment_id, rhid, checkout_id, mac_address, gateway_hash, amount, upload_rate, download_rate, session_expiry, processed)
          SELECT p.id, p.rhid, p.checkout_id, p.mac_address, p.gateway_hash, p.amount, pkg.upload_rate, pkg.download_rate, p.session_expiry, 0
          FROM payments p
          LEFT JOIN packages pkg ON p.amount = pkg.amount
          WHERE p.id = ?
          ON CONFLICT(payment_id) DO UPDATE SET rhid = excluded.rhid, processed = 0
        `).bind(activePay.id)
      ]);

      return Response.json({ success: true, checkout_id: activePay.checkout_id }, { headers: corsHeaders });
    }

    // --- 4. M-PESA STK PUSH ---
    if (url.pathname === "/initiate-stk") {
      const rawPhone = url.searchParams.get("phone");
      const phone = cleanPhoneNumber(rawPhone);
      const mac = url.searchParams.get("mac");
      const pkgId = url.searchParams.get("pkg");

      const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(pkgId).first();
      if (!pkg) {
        return Response.json({ success: false, error: "Invalid package" }, { status: 400, headers: corsHeaders });
      }

      let gatewayHash = "";
      if (mac) {
        const session = await env.DB.prepare("SELECT gateway_hash FROM client_sessions WHERE mac_address = ?").bind(mac).first();
        gatewayHash = session ? session.gateway_hash : "";
      }

      try {
        const accessToken = await getAccessToken(env);
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
        const password = btoa(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`);

        const mpesaReq = await fetch("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
          body: JSON.stringify({
            BusinessShortCode: env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline",
            Amount: pkg.amount,
            PartyA: phone,
            PartyB: env.MPESA_TILL_NUMBER,
            PhoneNumber: phone,
            CallBackURL: `https://${url.hostname}/notif-cv`,
            AccountReference: "BHS Cyber Wifi",
            TransactionDesc: `Internet - ${pkg.name}`
          })
        });

        const mData = await mpesaReq.json();
        if (mData.ResponseCode === "0") {
          await env.DB.prepare(
            "INSERT INTO payments (checkout_id, phone, amount, status, mac_address, duration_minutes, processed, gateway_hash) VALUES (?, ?, ?, 'PENDING', ?, ?, 0, ?)"
          ).bind(mData.CheckoutRequestID, phone, pkg.amount, mac, pkg.duration_hours * 60, gatewayHash).run();
          return Response.json({ success: true, checkout_id: mData.CheckoutRequestID }, { headers: corsHeaders });
        }
        return Response.json({ success: false, error: mData.errorMessage || mData.ResponseDescription || "STK Push Failed" }, { status: 400, headers: corsHeaders });
      } catch (e) {
        return Response.json({ success: false, error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    // --- 5. CALLBACK & STATUS ---
    if (url.pathname === "/notif-cv") {
      const data = await request.json();
      const result = data.Body.stkCallback;

      if (result.ResultCode === 0) {
        const payRow = await env.DB.prepare(
          "SELECT id, status, mac_address, duration_minutes, gateway_hash, amount FROM payments WHERE checkout_id = ?"
        ).bind(result.CheckoutRequestID).first();

        if (payRow && payRow.status === 'PAID') {
          return new Response("OK");
        }

        if (payRow) {
          const sessRow = await env.DB.prepare(
            "SELECT id, token FROM client_sessions WHERE mac_address = ?"
          ).bind(payRow.mac_address).first();

          if (sessRow) {
            const rhid = await generateRhid(sessRow.token, env.FAS_KEY);

            // Execute batch updates including denormalized rates insertion into active_payments
            await env.DB.batch([
              env.DB.prepare("UPDATE client_sessions SET rhid = ? WHERE id = ?").bind(rhid, sessRow.id),
              
              env.DB.prepare(`
                UPDATE payments 
                SET status = 'PAID', 
                    session_id = ?, 
                    rhid = ?, 
                    session_expiry = datetime('now', '+' || ? || ' minutes') 
                WHERE checkout_id = ?
              `).bind(sessRow.id, rhid, payRow.duration_minutes, result.CheckoutRequestID),

              env.DB.prepare(`
                INSERT INTO active_payments (payment_id, rhid, checkout_id, mac_address, gateway_hash, amount, upload_rate, download_rate, session_expiry, processed)
                SELECT p.id, p.rhid, p.checkout_id, p.mac_address, p.gateway_hash, p.amount, pkg.upload_rate, pkg.download_rate, p.session_expiry, 0
                FROM payments p
                LEFT JOIN packages pkg ON p.amount = pkg.amount
                WHERE p.checkout_id = ?
                ON CONFLICT(payment_id) DO UPDATE SET rhid = excluded.rhid, processed = 0, session_expiry = excluded.session_expiry
              `).bind(result.CheckoutRequestID)
            ]);
          }
        }
      } else {
        await env.DB.prepare("UPDATE payments SET status = 'FAILED' WHERE checkout_id = ?")
          .bind(result.CheckoutRequestID).run();
      }

      return new Response("OK");
    }

    if (url.pathname === "/status") {
      const checkoutId = url.searchParams.get("id");
      if (!checkoutId) {
        return Response.json({ status: "NOT_FOUND" }, { headers: corsHeaders });
      }
      const row = await env.DB.prepare("SELECT status, processed FROM payments WHERE checkout_id = ?").bind(checkoutId).first();
      return Response.json(row || { status: "NOT_FOUND" }, { headers: corsHeaders });
    }

    if (url.pathname === "/waiting") {
      return new Response(generateWaitingHTML(url.searchParams.get("id")), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("BHS WiFi Active\n", { headers: { "Content-Type": "text/plain" } });
  }
};

function generateLoginHTML(mac, clientip, pkgs) {
  const pkgElements = pkgs.map((p, idx) => {
    const speedMbps = p.download_rate ? (p.download_rate / 1000).toFixed(0) : 'Max';
    return `
      <div class="pkg ${idx === 0 ? 'selected' : ''}" id="pkg-${p.id}" onclick="sel('${p.id}')">
        <div class="pkg-header">
          <span class="pkg-name">${p.name}</span>
          <span class="pkg-badge">${speedMbps} Mbps</span>
        </div>
        <div class="pkg-price-container">
          <span class="pkg-currency">KSh</span>
          <span class="pkg-price">${p.amount}</span>
        </div>
      </div>
    `;
  }).join('');

  const firstPkgId = pkgs.length > 0 ? pkgs[0].id : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>BHS WIFI - Connect</title>
  <style>
    :root {
      --bg-glass: rgba(18, 20, 29, 0.85);
      --card-border: rgba(255, 255, 255, 0.12);
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.25);
      --accent-hover: #059669;
      --text-main: #ffffff;
      --text-muted: #94a3b8;
    }

    * { box-sizing: border-box; }

    body { 
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
      margin: 0; 
      min-height: 100vh; 
      display: flex; 
      align-items: center; 
      justify-content: center;
      background: #0f172a;
      background-image: 
        radial-gradient(at 0% 0%, rgba(30, 58, 138, 0.5) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.2) 0px, transparent 50%),
        radial-gradient(at 50% 50%, rgba(15, 23, 42, 0.9) 0px, transparent 100%);
      color: var(--text-main); 
      padding: 16px;
    }

    .card { 
      background: var(--bg-glass); 
      padding: 24px; 
      border-radius: 24px; 
      backdrop-filter: blur(20px); 
      -webkit-backdrop-filter: blur(20px); 
      border: 1px solid var(--card-border); 
      max-width: 420px; 
      width: 100%; 
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }

    .brand-header {
      text-align: center;
      margin-bottom: 20px;
    }

    .brand-title { 
      font-weight: 800; 
      margin: 0; 
      font-size: 24px; 
      letter-spacing: -0.5px; 
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .wifi-icon {
      width: 20px;
      height: 20px;
      fill: var(--accent);
    }

    .sub-head { 
      color: var(--accent); 
      font-size: 11px; 
      margin-top: 4px; 
      text-transform: uppercase; 
      letter-spacing: 2px; 
      font-weight: 700; 
    }

    .ip-display { 
      font-size: 11px; 
      color: var(--text-muted); 
      text-transform: none; 
      letter-spacing: normal; 
      margin-top: 2px; 
      font-weight: 500; 
    }

    .hidden { display: none !important; }

    /* Service Grid */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .section-title::before {
      content: '';
      width: 6px;
      height: 6px;
      background: var(--accent);
      border-radius: 50%;
    }

    .services-grid { 
      display: grid; 
      grid-template-columns: repeat(2, 1fr); 
      gap: 8px; 
      margin-bottom: 18px; 
    }

    .service-item { 
      background: rgba(255, 255, 255, 0.03); 
      padding: 10px; 
      border-radius: 12px; 
      border: 1px solid rgba(255, 255, 255, 0.06); 
      font-size: 11px; 
      font-weight: 600; 
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .service-item .icon { font-size: 16px; }

    /* Contact Banner */
    .contact-card {
      background: rgba(16, 185, 129, 0.08); 
      border: 1px solid rgba(16, 185, 129, 0.3); 
      border-radius: 14px; 
      padding: 12px 14px; 
      margin-bottom: 18px; 
      display: flex; 
      align-items: center; 
      justify-content: space-between;
    }

    .contact-title { font-size: 10px; text-transform: uppercase; font-weight: 800; color: var(--accent); letter-spacing: 1px; }
    .contact-num { font-size: 13px; font-weight: 700; margin-top: 2px; }
    .contact-hours { font-size: 10px; color: var(--text-muted); }
    .contact-actions { display: flex; gap: 6px; }

    .c-btn {
      background: #25d366; 
      color: #fff; 
      border: none; 
      padding: 6px 12px; 
      border-radius: 8px; 
      font-size: 11px; 
      font-weight: 700; 
      text-decoration: none; 
      display: inline-flex; 
      align-items: center; 
      gap: 4px;
      transition: 0.2s;
    }

    .c-btn.phone { background: #3b82f6; }
    .c-btn:hover { opacity: 0.9; }

    /* Packages UI */
    .pkg-grid { 
      display: grid; 
      grid-template-columns: repeat(2, 1fr); 
      gap: 10px; 
      margin-bottom: 18px; 
    }

    .pkg { 
      background: rgba(255, 255, 255, 0.04); 
      border: 1px solid var(--card-border); 
      padding: 12px; 
      border-radius: 14px; 
      cursor: pointer; 
      transition: all 0.2s ease;
      display: flex; 
      flex-direction: column; 
      justify-content: space-between;
    }

    .pkg:hover {
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.07);
    }

    .pkg.selected { 
      border: 2px solid var(--accent); 
      background: rgba(16, 185, 129, 0.12); 
      box-shadow: 0 4px 15px var(--accent-glow); 
    }

    .pkg-header { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 6px; }
    .pkg-name { font-size: 11px; font-weight: 700; color: var(--text-main); text-transform: uppercase; }
    .pkg-badge { font-size: 9px; background: var(--accent); color: #000; padding: 2px 6px; border-radius: 6px; font-weight: 800; }

    .pkg-price-container { display: flex; align-items: baseline; gap: 2px; }
    .pkg-currency { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .pkg-price { font-size: 20px; font-weight: 800; }

    /* Inputs & Buttons */
    .input-group {
      margin-bottom: 16px;
    }

    .input-label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    input { 
      width: 100%; 
      padding: 14px; 
      border-radius: 12px; 
      border: 1px solid var(--card-border); 
      background: rgba(0, 0, 0, 0.3); 
      color: #fff; 
      font-size: 18px; 
      font-weight: 700; 
      box-sizing: border-box; 
      text-align: center; 
      outline: none; 
      letter-spacing: 1px;
      transition: 0.2s;
    }

    input:focus { 
      border-color: var(--accent); 
      box-shadow: 0 0 0 3px var(--accent-glow); 
    }

    /* Helper Step Guide */
    .mini-steps {
      background: rgba(255, 255, 255, 0.03);
      border-radius: 12px;
      padding: 10px 12px;
      margin-bottom: 16px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .mini-step-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .mini-step-item:last-child { margin-bottom: 0; }
    .mini-step-num {
      width: 16px; height: 16px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 800; flex-shrink: 0;
    }

    .btn { 
      background: var(--accent); 
      color: #000; 
      border: none; 
      padding: 16px; 
      width: 100%; 
      border-radius: 12px; 
      font-weight: 800; 
      cursor: pointer; 
      font-size: 14px; 
      text-transform: uppercase; 
      letter-spacing: 0.5px; 
      transition: 0.2s;
      box-shadow: 0 4px 12px var(--accent-glow);
    }

    .btn:hover { background: var(--accent-hover); }
    .btn:active { transform: scale(0.98); }

    .btn.reconnect {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid var(--card-border);
      box-shadow: none;
      margin-top: 10px;
    }

    .btn.reconnect:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .btn.back { 
      background: transparent; 
      color: var(--text-muted); 
      padding: 10px; 
      margin-top: 8px; 
      font-size: 12px; 
      border: none; 
      box-shadow: none;
      text-transform: none;
    }

    .btn.back:hover { color: #fff; }

    .error-msg { 
      color: #ef4444; 
      font-size: 12px; 
      font-weight: 600; 
      margin-top: 10px; 
      text-align: center; 
      min-height: 16px; 
    }

    .divider {
      text-align: center;
      margin: 14px 0 6px 0;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>

  <div class="card">
    <div class="brand-header">
      <h2 class="brand-title">
        <svg class="wifi-icon" viewBox="0 0 24 24"><path d="M12 3C7.03 3 2.5 5.2 0 8.61L12 22 24 8.6C21.5 5.2 16.97 3 12 3zm0 4c3.87 0 7.39 1.54 10 4.06L12 21.05 2 11.06C4.61 8.54 8.13 7 12 7z"/></svg>
        BHS WIFI
      </h2>
      <div class="sub-head">High-Speed Cyber Portal</div>
      <div class="ip-display">IP Address: <span id="clientIpText">Detecting...</span></div>
    </div>

    <div id="adView">
      <div class="section-title">Cyber & Online Services</div>
      <div class="services-grid">
        <div class="service-item"><span class="icon">📋</span> KRA Returns & PIN</div>
        <div class="service-item"><span class="icon">🏛️</span> eCitizen Applications</div>
        <div class="service-item"><span class="icon">✈️</span> Passport & Visas</div>
        <div class="service-item"><span class="icon">🖨️</span> Print, Scan & Copy</div>
        <div class="service-item"><span class="icon">🚗</span> NTSA Licensing</div>
        <div class="service-item"><span class="icon">🆔</span> Good Conduct (DCI)</div>
        <div class="service-item"><span class="icon">🎓</span> KUCCPS & HELB</div>
        <div class="service-item"><span class="icon">💼</span> Business Permits</div>
      </div>

      <div class="contact-card">
        <div>
          <div class="contact-title">Need Help Connecting?</div>
          <div class="contact-num">0707 759 220</div>
          <div class="contact-hours">Help Desk: 8am – 6pm</div>
        </div>
        <div class="contact-actions">
          <a href="https://wa.me/254707759220?text=Hi%20BHS%20Cyber,%20I%20need%20help%20connecting%20to%20WIFI" target="_blank" class="c-btn">WhatsApp</a>
          <a href="tel:0707759220" class="c-btn phone">Call</a>
        </div>
      </div>

      <button class="btn" onclick="showPackages()">Buy Data Package</button>
      <button class="btn reconnect" id="reconnectBtn" onclick="reconnect()">Restore Paid Session</button>
      <div id="homeErrorDisplay" class="error-msg"></div>
    </div>

    <div id="payView" class="hidden">
      <div class="section-title">1. Select Data Package</div>
      <div class="pkg-grid">${pkgElements}</div>

      <div class="mini-steps">
        <div class="mini-step-item">
          <div class="mini-step-num">1</div>
          <span>Select your package above.</span>
        </div>
        <div class="mini-step-item">
          <div class="mini-step-num">2</div>
          <span>Enter your M-Pesa number & tap <strong>Pay & Connect</strong>.</span>
        </div>
        <div class="mini-step-item">
          <div class="mini-step-num">3</div>
          <span>Enter your M-Pesa PIN when prompted on your phone.</span>
        </div>
      </div>

      <div class="input-group">
        <label class="input-label" for="phone">2. M-Pesa Phone Number</label>
        <input type="tel" id="phone" placeholder="07XX XXX XXX" maxlength="12" autocomplete="tel">
      </div>

      <button class="btn" id="payBtn" onclick="pay()">Pay & Connect</button>
      <button class="btn back" onclick="showAd()">← Back to Services</button>
      <div id="errorDisplay" class="error-msg"></div>
    </div>
  </div>

  <script>
    let selectedPkgId = '${firstPkgId}';
    const macAddress = '${mac}';
    const clientIp = '${clientip}';

    window.addEventListener('DOMContentLoaded', () => {
      if (clientIp) {
        localStorage.setItem('bhs_client_ip', clientIp);
        document.getElementById('clientIpText').innerText = clientIp;
      } else {
        const storedIp = localStorage.getItem('bhs_client_ip');
        document.getElementById('clientIpText').innerText = storedIp || 'Unavailable';
      }
    });

    function showPackages() {
      document.getElementById('adView').classList.add('hidden');
      document.getElementById('payView').classList.remove('hidden');
    }

    function showAd() {
      document.getElementById('payView').classList.add('hidden');
      document.getElementById('adView').classList.remove('hidden');
    }

    function sel(id) { 
      selectedPkgId = id; 
      document.querySelectorAll('.pkg').forEach(e => e.classList.remove('selected')); 
      document.getElementById('pkg-' + id).classList.add('selected'); 
    }

    async function reconnect() {
      const btn = document.getElementById('reconnectBtn');
      const errEl = document.getElementById('homeErrorDisplay');
      errEl.innerText = '';
      btn.disabled = true;
      btn.innerText = "Restoring session...";

      try {
        const r = await fetch('/reconnect?mac=' + encodeURIComponent(macAddress));
        let d;
        try {
          d = await r.json();
        } catch(parseErr) {
          throw new Error('Invalid response from server.');
        }

        if (d.success) {
          window.location.href = '/waiting?id=' + d.checkout_id;
        } else {
          throw new Error(d.error || 'No active paid session found.');
        }
      } catch(e) {
        errEl.innerText = e.message || 'Error restoring session. Try purchasing a package.';
        btn.disabled = false;
        btn.innerText = "Restore Paid Session";
      }
    }

    async function pay() {
      if (window.speechSynthesis) {
         const initial = new SpeechSynthesisUtterance("");
         window.speechSynthesis.speak(initial);
      }

      const ph = document.getElementById('phone').value.trim();
      const errEl = document.getElementById('errorDisplay');
      errEl.innerText = '';

      if (ph.length < 10) {
        errEl.innerText = 'Please enter a valid phone number (e.g. 0712345678)';
        return;
      }

      const btn = document.getElementById('payBtn');
      btn.disabled = true; 
      btn.innerText = "Check your phone for PIN prompt...";

      try {
        const r = await fetch('/initiate-stk?phone=' + encodeURIComponent(ph) + '&mac=' + encodeURIComponent(macAddress) + '&pkg=' + selectedPkgId);
        let d;
        try {
          d = await r.json();
        } catch(parseErr) {
          throw new Error('Invalid server response format.');
        }

        if (!r.ok) {
          throw new Error(d.error || 'Server responded with an error status (' + r.status + ')');
        }

        if (d.success) {
          window.location.href = '/waiting?id=' + d.checkout_id;
        } else {
          throw new Error(d.error || 'STK Push failed');
        }
      } catch(e) {
        errEl.innerText = e.message || 'Network error occurred. Please try again.';
        btn.disabled = false; 
        btn.innerText = "Pay & Connect";
      }
    }
  </script>
</body>
</html>`;
}

function generateWaitingHTML(id) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>BHS WIFI - Verifying Payment</title>
  <style>
    :root {
      --bg-glass: rgba(18, 20, 29, 0.88);
      --card-border: rgba(255, 255, 255, 0.12);
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.25);
      --danger: #ef4444;
      --text-main: #ffffff;
      --text-muted: #94a3b8;
    }

    * { box-sizing: border-box; }

    body { 
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
      margin: 0; 
      min-height: 100vh; 
      display: flex; 
      align-items: center; 
      justify-content: center;
      background: #0f172a;
      background-image: 
        radial-gradient(at 0% 0%, rgba(30, 58, 138, 0.5) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.2) 0px, transparent 50%),
        radial-gradient(at 50% 50%, rgba(15, 23, 42, 0.9) 0px, transparent 100%);
      color: var(--text-main); 
      padding: 16px;
      text-align: center;
    }

    .card { 
      background: var(--bg-glass); 
      padding: 24px; 
      border-radius: 24px; 
      backdrop-filter: blur(20px); 
      -webkit-backdrop-filter: blur(20px); 
      border: 1px solid var(--card-border); 
      max-width: 380px; 
      width: 100%; 
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }

    /* Modern Loader */
    .loader-container {
      position: relative;
      width: 60px;
      height: 60px;
      margin: 10px auto 20px;
    }

    .loader { 
      border: 4px solid rgba(255, 255, 255, 0.08); 
      border-top: 4px solid var(--accent); 
      border-radius: 50%; 
      width: 100%; 
      height: 100%; 
      animation: spin 1s linear infinite; 
    }

    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .status-text { 
      font-size: 20px; 
      font-weight: 800; 
      margin-bottom: 6px; 
      letter-spacing: -0.3px;
    }

    .sub-text { 
      color: var(--text-muted); 
      font-size: 13px; 
      line-height: 1.4; 
      margin-top: 0;
      margin-bottom: 12px; 
    }

    .ip-info { 
      font-size: 11px; 
      color: var(--text-muted); 
      margin-bottom: 20px; 
      font-weight: 500; 
    }

    .error-box { 
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5; 
      font-size: 12px; 
      font-weight: 600; 
      padding: 12px;
      border-radius: 12px;
      margin-top: 15px; 
      margin-bottom: 15px;
      display: none; 
      line-height: 1.4;
    }

    /* Ad Carousel Box */
    .ad-container { 
      background: rgba(255, 255, 255, 0.03); 
      border-radius: 14px; 
      padding: 14px; 
      border: 1px solid rgba(255, 255, 255, 0.08); 
      font-size: 12px; 
      margin-bottom: 16px;
      min-height: 68px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ad-slide { 
      display: none; 
      line-height: 1.4;
    }
    
    .ad-slide.active { 
      display: block; 
      animation: fadeIn 0.4s ease-in-out; 
    }

    .ad-slide strong {
      color: var(--accent);
      font-weight: 700;
      display: block;
      margin-bottom: 2px;
      font-size: 13px;
    }

    /* Portal Ad Callout */
    .promo-banner {
      background: rgba(255, 255, 255, 0.02);
      border: 1px dashed rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 16px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .promo-banner strong {
      color: #fff;
      display: block;
      margin-bottom: 2px;
    }

    /* Support Banner */
    .contact-card {
      background: rgba(16, 185, 129, 0.08); 
      border: 1px solid rgba(16, 185, 129, 0.3); 
      border-radius: 14px; 
      padding: 12px; 
      display: flex; 
      align-items: center; 
      justify-content: space-between;
      text-align: left;
    }

    .contact-title { font-size: 10px; text-transform: uppercase; font-weight: 800; color: var(--accent); letter-spacing: 1px; }
    .contact-num { font-size: 12px; font-weight: 700; margin-top: 2px; }
    .contact-actions { display: flex; gap: 6px; }

    .c-btn {
      background: #25d366; 
      color: #fff; 
      border: none; 
      padding: 6px 10px; 
      border-radius: 8px; 
      font-size: 10px; 
      font-weight: 700; 
      text-decoration: none; 
      display: inline-flex; 
      align-items: center; 
      gap: 3px;
      transition: 0.2s;
    }

    .c-btn.phone { background: #3b82f6; }
    .c-btn:hover { opacity: 0.9; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>

  <div class="card">
    <div class="loader-container" id="loader">
      <div class="loader"></div>
    </div>
    
    <div class="status-text" id="msg">Verifying Payment</div>
    <p class="sub-text" id="submsg">Checking M-Pesa status. Please complete the prompt on your phone...</p>
    
    <div class="ip-info">Device IP: <span id="waitingIp">Loading...</span></div>
    
    <div id="errorBox" class="error-box"></div>

    <!-- Cyber Services Rotating Ads -->
    <div class="ad-container">
      <div class="ad-slide active">
        <strong>📋 KRA Returns & PIN Services</strong>
        Filing, PIN registration & tax compliance checks.
      </div>
      <div class="ad-slide">
        <strong>🏛️ eCitizen Portal Services</strong>
        Good conduct certificates, business search & driving licenses.
      </div>
      <div class="ad-slide">
        <strong>✈️ Passports & Visas</strong>
        Application processing & booking appointments fast.
      </div>
      <div class="ad-slide">
        <strong>🖨️ Printing & Document Scanning</strong>
        High quality document color printouts & scanning.
      </div>
      <div class="ad-slide">
        <strong>🎓 KUCCPS & HELB Applications</strong>
        Student portal assistance & loan applications.
      </div>
    </div>

    <!-- Portal Business Ad Banner -->
    <div class="promo-banner">
      <strong>Want to grow your business?</strong>
      Advertise your products or services on this WiFi portal. Contact our office!
    </div>

    <!-- Help & Assistance Bar -->
    <div class="contact-card">
      <div>
        <div class="contact-title">Issue or Delays?</div>
        <div class="contact-num">0707 759 220</div>
      </div>
      <div class="contact-actions">
        <a href="https://wa.me/254707759220?text=Hi%20BHS%20Cyber,%20I%20need%20help%20with%20my%20WIFI%20payment%20(ID:%20${id})" target="_blank" class="c-btn">WhatsApp</a>
        <a href="tel:0707759220" class="c-btn phone">Call</a>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      const storedIp = localStorage.getItem('bhs_client_ip');
      if (storedIp) {
        document.getElementById('waitingIp').innerText = storedIp;
      } else {
        document.getElementById('waitingIp').innerText = "Not Found";
      }
    });

    function speakSuccess() {
      if ('speechSynthesis' in window) {
        const msg = new SpeechSynthesisUtterance("Connected. Welcome to B.H.S WiFi");
        msg.rate = 1;
        msg.pitch = 1;
        window.speechSynthesis.speak(msg);
      }
    }

    // Auto-rotate Ads
    let cur = 0; 
    const ads = document.querySelectorAll('.ad-slide');
    setInterval(() => { 
      ads[cur].classList.remove('active'); 
      cur = (cur + 1) % ads.length; 
      ads[cur].classList.add('active'); 
    }, 3500);

    let consecutiveErrors = 0;
    const maxErrors = 5;
    let pollCount = 0;
    const maxPolls = 48; // Stop polling after 2 minutes (48 * 2.5s) to save DB reads

    const poll = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(poll);
        document.getElementById('loader').style.display = "none";
        document.getElementById('submsg').style.display = "none";
        const errBox = document.getElementById('errorBox');
        errBox.innerHTML = "Payment verification timed out.<br>If you completed payment, please call or WhatsApp support below.";
        errBox.style.display = "block";
        return;
      }

      try {
        const r = await fetch('/status?id=${id}');
        if (!r.ok) {
          throw new Error('Status check failed');
        }
        const d = await r.json();
        consecutiveErrors = 0;

        if (d.status === 'PAID' && d.processed === 1) {
          clearInterval(poll);
          document.getElementById('msg').innerText = "Connected!";
          document.getElementById('msg').style.color = "#10b981";
          document.getElementById('loader').style.display = "none";
          document.getElementById('submsg').innerText = "Redirecting you to the internet now...";

          speakSuccess();

          setTimeout(() => window.location.href = "http://connectivitycheck.gstatic.com/generate_204", 2500);
        } else if (d.status === 'FAILED') {
          clearInterval(poll);
          document.getElementById('msg').innerText = "Payment Failed";
          document.getElementById('msg').style.color = "#ef4444";
          document.getElementById('loader').style.display = "none";
          document.getElementById('submsg').innerText = "The transaction was cancelled or failed.";
          
          const errBox = document.getElementById('errorBox');
          errBox.innerText = "Transaction failed. Please tap Back on the login page to try again or reach support below.";
          errBox.style.display = "block";
        }
      } catch(e) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxErrors) {
          clearInterval(poll);
          document.getElementById('loader').style.display = "none";
          document.getElementById('submsg').style.display = "none";
          const errBox = document.getElementById('errorBox');
          errBox.innerText = "Connection lost while checking status. Please check your WiFi connection or reach support below.";
          errBox.style.display = "block";
        }
      }
    }, 2500);
  </script>
</body>
</html>`;
}