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
  // If starts with 07... or 01...
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  }
  // If starts with 7... or 1... (missing prefix)
  else if ((cleaned.startsWith('7') || cleaned.startsWith('1')) && cleaned.length === 9) {
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- 1. AUTHMON POLLING ---
    const authGet = url.searchParams.get("auth_get");
    if (authGet !== null) {
      const payload = url.searchParams.get("payload") || "";
      const isRecovery = url.searchParams.get("recovery") === "true"; 
      const gateway = url.searchParams.get("gateway") || "bhscyber"; 

      if (payload.startsWith("*") && payload.length > 1) {
        const tokensToAck = payload.replace(/\*/g, "").trim().split(/\s+/).filter(t => t.length > 0);
        if (tokensToAck.length > 0) {
          for (const token of tokensToAck) {
            await env.DB.prepare(`UPDATE payments SET processed = 1 WHERE rhid = ? AND status = 'PAID'`).bind(token).run();
          }
        }
        return new Response("ACK_OK\n", { headers: { "Content-Type": "text/plain" } });
      }

      const query = isRecovery 
        ? `SELECT rhid, duration_minutes, mac_address FROM payments 
           WHERE status = 'PAID' AND duration_minutes > 0 AND gateway_hash = ? AND rhid IS NOT NULL`
        : `SELECT rhid, duration_minutes, mac_address FROM payments 
           WHERE status = 'PAID' AND processed = 0 AND duration_minutes > 0 AND gateway_hash = ? AND rhid IS NOT NULL`;

      const { results } = await env.DB.prepare(query).bind(gateway).all();

      if (results && results.length > 0) {
        const authList = results.map((r) => `* ${r.rhid} ${r.duration_minutes} 0 0 0 0 ${r.mac_address}`).join("\n");
        return new Response(authList + "\n", { headers: { "Content-Type": "text/plain" } });
      }
      return new Response("*\n", { headers: { "Content-Type": "text/plain" } });
    }

    // --- 2. HEARTBEAT ENDPOINT ---
    if (url.pathname === "/heartbeat" && request.method === "POST") {
      try {
        const body = await request.json();
        const gatewayHash = body.gateway_hash;
        if (!gatewayHash) return new Response("Missing gateway_hash", { status: 400 });

        await env.DB.prepare(`
          UPDATE payments 
          SET duration_minutes = MAX(0, duration_minutes - 2) 
          WHERE gateway_hash = ? 
            AND status = 'PAID' 
            AND processed = 1 
            AND duration_minutes > 0
        `).bind(gatewayHash).run();

        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (e) {
        return new Response("Heartbeat Error", { status: 500 });
      }
    }

    // --- 3. FAS HANDSHAKE ---
    const fasBlob = url.searchParams.get("fas");
    if (fasBlob) {
      try {
        const decoded = atob(fasBlob.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/"));
        const params = new URLSearchParams(decoded.replace(/, /g, "&"));
        const clientmac = params.get("clientmac") || "";
        const token = params.get("hid") || "";
        const gatewayHash = params.get("gatewayname") || "";
        const clientip = params.get("clientip") || "";

        const { results: pkgs } = await env.DB.prepare("SELECT * FROM packages ORDER BY amount ASC").all();

        if (clientmac) {
          await env.DB.prepare(`
            INSERT INTO client_sessions (mac_address, token, gateway_hash, client_ip) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(mac_address) DO UPDATE SET 
              token = excluded.token, 
              gateway_hash = excluded.gateway_hash,
              client_ip = excluded.client_ip,
              created_at = CURRENT_TIMESTAMP
          `).bind(clientmac, token, gatewayHash, clientip).run();
        }
        return new Response(generateLoginHTML(clientmac, pkgs), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch (e) {
        return new Response("FAS Error", { status: 400 });
      }
    }

    // --- 4. M-PESA STK PUSH (With Number Cleaning) ---
    if (url.pathname === "/initiate-stk") {
      const rawPhone = url.searchParams.get("phone");
      const phone = cleanPhoneNumber(rawPhone); // Logic Change: Clean the number
      const mac = url.searchParams.get("mac");
      const pkgId = url.searchParams.get("pkg");

      const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(pkgId).first();
      
      if (!pkg) {
        return Response.json({ success: false, error: "Invalid package" }, { status: 400, headers: corsHeaders });
      }

      const session = await env.DB.prepare("SELECT gateway_hash FROM client_sessions WHERE mac_address = ?").bind(mac).first();
      const gatewayHash = session ? session.gateway_hash : "";

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
        return Response.json({ success: false, error: "STK Push Failed" }, { status: 400, headers: corsHeaders });
      } catch (e) {
        return Response.json({ success: false, error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    // --- 5. CALLBACK & OTHERS (UNCHANGED) ---
    if (url.pathname === "/notif-cv") {
      const data = await request.json();
      const result = data.Body.stkCallback;
      if (result.ResultCode === 0) {
        const payRow = await env.DB.prepare("SELECT mac_address FROM payments WHERE checkout_id = ?").bind(result.CheckoutRequestID).first();
        const sessRow = await env.DB.prepare("SELECT id, token FROM client_sessions WHERE mac_address = ?").bind(payRow.mac_address).first();
        if (sessRow) {
          const rhid = await generateRhid(sessRow.token, env.FAS_KEY);
          await env.DB.prepare("UPDATE client_sessions SET rhid = ? WHERE id = ?").bind(rhid, sessRow.id).run();
          await env.DB.prepare("UPDATE payments SET status = 'PAID', session_id = ?, rhid = ? WHERE checkout_id = ?").bind(sessRow.id, rhid, result.CheckoutRequestID).run();
        }
      } else {
        await env.DB.prepare("UPDATE payments SET status = 'FAILED' WHERE checkout_id = ?").bind(result.CheckoutRequestID).run();
      }
      return new Response("OK");
    }

    if (url.pathname === "/status") {
      const row = await env.DB.prepare("SELECT status, processed FROM payments WHERE checkout_id = ?").bind(url.searchParams.get("id")).first();
      return Response.json(row || { status: "NOT_FOUND" }, { headers: corsHeaders });
    }
    if (url.pathname === "/waiting") {
      return new Response(generateWaitingHTML(url.searchParams.get("id")), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("BHS WiFi Active\n", { headers: { "Content-Type": "text/plain" } });
  }
};

// --- HTML GENERATORS ---
function generateLoginHTML(mac, pkgs) {
  const pkgElements = pkgs.map((p, idx) => `
    <div class="pkg ${idx === 0 ? 'selected' : ''}" id="pkg-${p.id}" onclick="sel('${p.id}')">
      <div class="pkg-name">${p.name}</div>
      <div class="pkg-price">${p.amount}</div>
    </div>
  `).join('');

  const firstPkgId = pkgs.length > 0 ? pkgs[0].id : '';

  return `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <style>
    :root { --glass: rgba(10, 10, 10, 0.92); --border: rgba(255, 255, 255, 0.18); --accent: #2ecc71; }
    
    body { 
      font-family: 'Inter', -apple-system, system-ui, sans-serif; 
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab, #9b59b6, #f1c40f);
      background-size: 600% 600%;
      animation: rainbowBG 18s ease infinite;
      color: #fff; padding: 10px; box-sizing: border-box;
      overflow: hidden;
    }

    @keyframes rainbowBG {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .card { 
      background: var(--glass); padding: 22px; border-radius: 30px; backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); 
      border: 1px solid var(--border); max-width: 400px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.6);
    }

    h2 { font-weight: 900; margin: 0; font-size: 26px; color: #fff; letter-spacing: -1px; text-align: center; }
    .sub-head { color: var(--accent); font-size: 11px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 3px; font-weight: 800; text-align: center; }
    
    .section-label { 
      text-align: left; font-size: 10px; font-weight: 900; color: rgba(255,255,255,0.6); 
      margin: 0 0 8px 5px; text-transform: uppercase; display: flex; align-items: center;
    }
    .section-label::before {
      content: ''; display: inline-block; width: 6px; height: 6px; background: var(--accent); margin-right: 8px; border-radius: 50%;
    }

    .pkg-grid { 
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 20px; 
    }
    
    .pkg { 
      background: rgba(255,255,255,0.06); border: 1px solid var(--border); 
      padding: 12px 5px; border-radius: 14px; cursor: pointer; transition: 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
    }
    .pkg.selected { border: 2.5px solid var(--accent); background: rgba(46, 204, 113, 0.2); transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
    .pkg-name { font-size: 10px; opacity: 0.9; margin-bottom: 2px; font-weight: 700; text-transform: uppercase; }
    .pkg-price { font-size: 18px; font-weight: 900; }
    .pkg-price::after { content: "/-"; font-size: 12px; margin-left: 1px; opacity: 0.6; }

    .input-container { background: rgba(255,255,255,0.04); border-radius: 16px; padding: 12px; border: 1px solid var(--border); margin-bottom: 15px; }
    input { 
      width: 100%; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); 
      background: #000; color: #fff; font-size: 20px; font-weight: 800; 
      box-sizing: border-box; text-align: center; outline: none; transition: 0.3s;
    }
    input:focus { border-color: var(--accent); box-shadow: 0 0 15px rgba(46, 204, 113, 0.3); }

    .btn { 
      background: var(--accent); color: #000; border: none; padding: 16px; width: 100%; 
      border-radius: 16px; font-weight: 900; cursor: pointer; font-size: 15px; 
      text-transform: uppercase; letter-spacing: 1px; transition: 0.3s;
    }
    .btn:active { transform: scale(0.97); }

    .ad-box { margin-top: 15px; font-size: 11px; padding-top: 12px; border-top: 1px solid var(--border); color: rgba(255,255,255,0.5); line-height: 1.4; text-align: center; }
  </style></head>
  <body>
    <div class="card">
      <h2>BHS WIFI</h2>
      <div class="sub-head">Ultra High Speed</div>
      <div class="section-label">1. Select Plan</div>
      <div class="pkg-grid">${pkgElements}</div>
      <div class="section-label">2. M-Pesa Number</div>
      <div class="input-container">
        <input type="tel" id="phone" placeholder="0712 345 678" maxlength="12">
      </div>
      <button class="btn" id="payBtn" onclick="pay()">Secure Connect</button>
      <div class="ad-box">
        <strong>BHS CYBER SERVICES</strong><br>KRA, e-Citizen & Printing.
      </div>
    </div>
    <script>
      let selectedPkgId = '${firstPkgId}';
      function sel(id) { 
        selectedPkgId = id; 
        document.querySelectorAll('.pkg').forEach(e=>e.classList.remove('selected')); 
        document.getElementById('pkg-'+id).classList.add('selected'); 
      }
      async function pay() {
        // Unlock audio context/speech for later use on this gesture
        if (window.speechSynthesis) {
           const initial = new SpeechSynthesisUtterance("");
           window.speechSynthesis.speak(initial);
        }

        const ph = document.getElementById('phone').value.trim();
        if(ph.length < 10) return alert('Invalid phone number');
        const btn = document.getElementById('payBtn');
        btn.disabled = true; btn.innerText = "Processing...";
        try {
          const r = await fetch('/initiate-stk?phone='+encodeURIComponent(ph)+'&mac=${mac}&pkg='+selectedPkgId);
          const d = await r.json();
          if(d.success) window.location.href = '/waiting?id=' + d.checkout_id;
          else { alert('Error: ' + d.error); btn.disabled = false; btn.innerText = "Secure Connect"; }
        } catch(e) { alert('Network error.'); btn.disabled = false; btn.innerText = "Secure Connect"; }
      }
    </script>
  </body></html>`;
}

function generateWaitingHTML(id) {
  return `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { --glass: rgba(10, 10, 10, 0.95); --accent: #2ecc71; }
    body { 
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab, #9b59b6, #f1c40f);
      background-size: 600% 600%;
      animation: rainbowBG 18s ease infinite;
      font-family: sans-serif; color: white; text-align: center;
    }
    @keyframes rainbowBG {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .card { padding: 40px 25px; background: var(--glass); border-radius: 30px; width: 85%; max-width: 350px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 30px 60px rgba(0,0,0,0.7); }
    .loader { border: 5px solid rgba(255,255,255,0.1); border-top: 5px solid var(--accent); border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 25px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .status-text { font-size: 22px; font-weight: 800; margin-bottom: 12px; }
    .sub-text { opacity: 0.7; font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
    .ad-container { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 15px; border: 1px dashed rgba(255,255,255,0.2); font-size: 13px; }
    .ad-slide { display: none; }
    .ad-slide.active { display: block; animation: fadeIn 0.5s; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style></head>
  <body>
    <div class="card">
      <div id="loader" class="loader"></div>
      <div class="status-text" id="msg">Verifying Payment</div>
      <p class="sub-text" id="submsg">Enter your M-Pesa PIN on your phone to complete connection.</p>
      <div class="ad-container">
        <div class="ad-slide active"><strong>Fast Printing</strong><br>Color prints available now.</div>
        <div class="ad-slide"><strong>Cyber Services</strong><br>KRA & e-Citizen services.</div>
      </div>
    </div>
    <script>
      function speakSuccess() {
        if ('speechSynthesis' in window) {
          const msg = new SpeechSynthesisUtterance("Connected. Welcome to B.H.S WiFi");
          msg.rate = 1;
          msg.pitch = 1;
          window.speechSynthesis.speak(msg);
        }
      }

      let cur = 0; const ads = document.querySelectorAll('.ad-slide');
      setInterval(() => { ads[cur].classList.remove('active'); cur = (cur+1)%ads.length; ads[cur].classList.add('active'); }, 3000);
      
      const poll = setInterval(async () => {
        try {
          const r = await fetch('/status?id=${id}');
          const d = await r.json();
          if (d.status === 'PAID' && d.processed === 1) {
            clearInterval(poll);
            document.getElementById('msg').innerText = "Connected!";
            document.getElementById('msg').style.color = "#2ecc71";
            document.getElementById('loader').style.display = "none";
            document.getElementById('submsg').innerText = "Redirecting you now...";
            
            speakSuccess();
            
            setTimeout(() => window.location.href = "http://connectivitycheck.gstatic.com/generate_204", 2500);
          }
        } catch(e) {}
      }, 2500);
    </script>
  </body></html>`;
}