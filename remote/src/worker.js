export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Serve the UI on GET requests
    if (request.method === "GET") {
      return new Response(getHtmlUi(), {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    // 2. Handle API requests (POST)
    if (request.method === "POST") {
      try {
        const data = await request.json();
        const { action, gateway_hash, tunnel_status, response, pending_output, command } = data;

        if (action === "get_gateways") {
          const { results } = await env.DB.prepare(
            `SELECT gateway_hash, tunnel_status, last_seen, pending_command, pending_output, response FROM gateway_status ORDER BY last_seen DESC`
          ).all();
          return jsonResponse({ gateways: results });
        }

        if (action === "get_gateway_details") {
          if (!gateway_hash) return jsonResponse({ error: "Missing gateway_hash" }, 400);
          const row = await env.DB.prepare(
            `SELECT * FROM gateway_status WHERE gateway_hash = ?`
          ).bind(gateway_hash).first();
          return jsonResponse({ gateway: row });
        }

        if (action === "send_command") {
          if (!gateway_hash) return jsonResponse({ error: "Missing gateway_hash" }, 400);
          
          const sanitizedCommand = command ? command.toLowerCase() : command;

          await env.DB.prepare(
            `UPDATE gateway_status SET pending_command = ? WHERE gateway_hash = ?`
          ).bind(sanitizedCommand, gateway_hash).run();
          return jsonResponse({ status: "command_queued" });
        }

        if (action === "set_tunnel_status") {
          if (!gateway_hash || tunnel_status === undefined) return jsonResponse({ error: "Missing parameters" }, 400);
          await env.DB.prepare(
            `UPDATE gateway_status SET tunnel_status = ? WHERE gateway_hash = ?`
          ).bind(tunnel_status, gateway_hash).run();
          return jsonResponse({ status: "tunnel_status_updated" });
        }

        // Router endpoints require gateway_hash
        if (!gateway_hash) {
          return jsonResponse({ error: "Missing gateway_hash" }, 400);
        }

        // Router Callback: Router posting execution output back
        if (pending_output !== undefined) {
          await env.DB.prepare(`
            UPDATE gateway_status 
            SET pending_output = ?, pending_command = NULL, last_seen = CURRENT_TIMESTAMP 
            WHERE gateway_hash = ?
          `).bind(pending_output, gateway_hash).run();
          return jsonResponse({ status: "output_received" });
        }

        // Router Heartbeat: Updates response & last_seen. 
        await env.DB.prepare(`
          INSERT INTO gateway_status (gateway_hash, tunnel_status, response, last_seen)
          VALUES (?, COALESCE(?, 0), ?, CURRENT_TIMESTAMP)
          ON CONFLICT(gateway_hash) 
          DO UPDATE SET 
            tunnel_status = CASE WHEN ? = 2 THEN 2 ELSE tunnel_status END,
            response = COALESCE(?, response),
            last_seen = CURRENT_TIMESTAMP
        `).bind(gateway_hash, tunnel_status, response || null, tunnel_status, response || null).run();

        // Fetch latest state to reply to the router
        const row = await env.DB.prepare(
          `SELECT pending_command, tunnel_status FROM gateway_status WHERE gateway_hash = ?`
        ).bind(gateway_hash).first();

        return jsonResponse({ 
          status: "success", 
          tunnel_status: row?.tunnel_status ?? 0,
          pending_command: row?.pending_command || null 
        });

      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Modern Sleek Dashboard UI (No Terminal Simulation)
function getHtmlUi() {
  return `<!DOCTYPE html>
<html lang="en" data-bs-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Modern Gateway Management Console</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        :root {
            --bs-body-bg: #0b0f19;
            --bs-body-color: #94a3b8;
            --card-bg: #111827;
            --border-color: #1f2937;
        }
        body { background-color: var(--bs-body-bg); color: var(--bs-body-color); font-family: system-ui, -apple-system, sans-serif; }
        .card { background-color: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
        .table { color: #e2e8f0; font-size: 0.9rem; vertical-align: middle; }
        .table-hover tbody tr:hover { background-color: rgba(30, 41, 59, 0.5); }
        .gateway-row { cursor: pointer; transition: all 0.2s ease; }
        .gateway-row.active-row { background-color: rgba(59, 130, 246, 0.15) !important; border-left: 4px solid #3b82f6; }
        .mac-text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #38bdf8; font-weight: 500; }
        .badge-status { padding: 0.35em 0.65em; font-weight: 500; border-radius: 6px; }
        .action-card { background: rgba(17, 24, 39, 0.7); backdrop-filter: blur(8px); }
        .btn-sleek { border-radius: 8px; font-weight: 500; font-size: 0.85rem; padding: 0.4rem 0.8rem; transition: all 0.2s; }
        .form-control-sleek { background-color: #030712; border: 1px solid #374151; color: #f3f4f6; border-radius: 8px; font-size: 0.85rem; }
        .form-control-sleek:focus { background-color: #030712; border-color: #3b82f6; color: #fff; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); }
    </style>
</head>
<body class="p-3 p-md-4">

    <div class="container-fluid max-width-1400">
        <!-- Top Navigation Bar -->
        <header class="d-flex flex-column flex-md-row justify-content-between align-items-md-center pb-3 mb-4 border-bottom border-secondary border-opacity-25">
            <div class="d-flex align-items-center gap-3">
                <div class="bg-primary bg-opacity-10 p-2 rounded-3 border border-primary border-opacity-25 text-primary">
                    <i class="bi bi-shield-lock-fill fs-4"></i>
                </div>
                <div>
                    <h1 class="h5 mb-0 text-white fw-bold">openNDS Gateway Control Hub</h1>
                    <p class="mb-0 small text-muted">Modern remote client authentication & fleet management</p>
                </div>
            </div>
            <div class="mt-3 mt-md-0 d-flex gap-2">
                <span class="badge bg-dark border border-secondary border-opacity-50 text-light px-3 py-2 d-flex align-items-center gap-2">
                    <i class="bi bi-circle-fill text-success small" style="font-size: 0.5rem;"></i> Cloud D1 Engine Active
                </span>
            </div>
        </header>

        <div class="row g-4">
            <!-- Left Side: Gateways List & System Management -->
            <div class="col-12 col-xl-4">
                <div class="card p-3 p-md-4 mb-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h2 class="h6 text-white mb-0 fw-semibold"><i class="bi bi-router me-2 text-primary"></i> Gateway Fleet</h2>
                        <span class="badge bg-secondary bg-opacity-25 text-secondary border border-secondary border-opacity-25" id="gateway-count">0 Online</span>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-dark table-hover align-middle mb-0 bg-transparent">
                            <thead>
                                <tr class="text-muted small border-bottom border-secondary border-opacity-25">
                                    <th>Status</th>
                                    <th>Gateway Hash</th>
                                    <th class="text-end">Last Seen</th>
                                </tr>
                            </thead>
                            <tbody id="gateway-table-body">
                                <tr><td colspan="3" class="text-center text-muted py-4">Loading gateways...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Global Router Action Panel -->
                <div class="card p-3 p-md-4 action-card">
                    <h3 class="h6 text-white mb-3 fw-semibold"><i class="bi bi-sliders me-2 text-warning"></i> Gateway Controls</h3>
                    <div id="selected-gateway-label" class="small text-muted mb-3 font-monospace">No gateway selected</div>
                    <div class="d-grid gap-2">
                        <button id="refresh-clients-btn" class="btn btn-sleek btn-outline-info text-start d-flex justify-content-between align-items-center" onclick="refreshClientList()" disabled>
                            <span><i class="bi bi-arrow-repeat me-2"></i> Fetch Client Inventory (ndsctl json)</span>
                            <i class="bi bi-chevron-right small"></i>
                        </button>
                        <button id="status-btn" class="btn btn-sleek btn-outline-secondary text-start d-flex justify-content-between align-items-center" onclick="triggerSystemAction('ndsctl status')" disabled>
                            <span><i class="bi bi-info-circle me-2"></i> Query System Status</span>
                            <i class="bi bi-chevron-right small"></i>
                        </button>
                        <button id="reboot-btn" class="btn btn-sleek btn-outline-danger text-start d-flex justify-content-between align-items-center mt-2" onclick="confirmReboot()" disabled>
                            <span><i class="bi bi-power me-2"></i> Reboot Gateway Router</span>
                            <i class="bi bi-exclamation-triangle text-warning small"></i>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Right Side: Modern Client Devices List Manager -->
            <div class="col-12 col-xl-8">
                <div class="card p-3 p-md-4 h-100">
                    <div class="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center mb-4 gap-3">
                        <div>
                            <h2 class="h6 text-white mb-1 fw-semibold" id="clients-panel-title">
                                <i class="bi bi-people-fill me-2 text-info"></i> Connected Captive Portal Clients
                            </h2>
                            <p class="mb-0 small text-muted" id="clients-subtext">Select a gateway router to manage users</p>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <button id="tunnel-toggle-btn" class="btn btn-sm btn-outline-warning btn-sleek" onclick="toggleTunnelStatus()" disabled>
                                <i class="bi bi-shield-exclamation me-1"></i> Request Tunnel
                            </button>
                        </div>
                    </div>

                    <!-- Sleek Client Inventory Table -->
                    <div class="table-responsive" style="min-height: 380px;">
                        <table class="table table-dark table-striped align-middle mb-0 bg-transparent">
                            <thead>
                                <tr class="text-muted small border-bottom border-secondary border-opacity-25">
                                    <th>Client Device (MAC / IP)</th>
                                    <th>Interface</th>
                                    <th>Authentication State</th>
                                    <th style="width: 140px;">Session Minutes</th>
                                    <th class="text-end" style="width: 140px;">Action</th>
                                </tr>
                            </thead>
                            <tbody id="clients-table-body">
                                <tr>
                                    <td colspan="5" class="text-center py-5 text-muted">
                                        <div class="py-4">
                                            <i class="bi bi-hdd-network display-6 opacity-25 d-block mb-3"></i>
                                            Select an active gateway from the left panel to inspect and manage connected clients.
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        let selectedGateway = null;
        let currentTunnelStatus = 0;

        async function fetchGateways() {
            try {
                const res = await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'get_gateways' })
                });
                const data = await res.json();
                const tbody = document.getElementById('gateway-table-body');
                
                if (!data.gateways || data.gateways.length === 0) {
                    tbody.innerHTML = \`<tr><td colspan="3" class="text-center text-muted py-4">No gateways registered.</td></tr>\`;
                    document.getElementById('gateway-count').innerText = '0 Online';
                    return;
                }

                document.getElementById('gateway-count').innerText = \`\${data.gateways.length} Registered\`;

                tbody.innerHTML = data.gateways.map(g => {
                    let badgeClass = 'bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25';
                    let statusText = 'OFFLINE';
                    if (g.tunnel_status === 1) { badgeClass = 'bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25'; statusText = 'REQUESTING'; }
                    if (g.tunnel_status === 2) { badgeClass = 'bg-success bg-opacity-10 text-success border border-success border-opacity-25'; statusText = 'CONNECTED'; }

                    return \`
                        <tr class="gateway-row \${selectedGateway === g.gateway_hash ? 'active-row' : ''}" onclick="selectGateway('\${g.gateway_hash}')">
                            <td><span class="badge badge-status \${badgeClass}">\${statusText}</span></td>
                            <td><span class="mac-text text-info">\${g.gateway_hash.substring(0, 10)}...</span></td>
                            <td class="text-end text-muted small">\${new Date(g.last_seen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</td>
                        </tr>
                    \`;
                }).join('');

                if (selectedGateway) {
                    fetchGatewayDetails(selectedGateway);
                }
            } catch (err) {
                console.error('Failed to load gateways', err);
            }
        }

        async function selectGateway(hash) {
            selectedGateway = hash;
            document.getElementById('refresh-clients-btn').disabled = false;
            document.getElementById('status-btn').disabled = false;
            document.getElementById('reboot-btn').disabled = false;
            document.getElementById('selected-gateway-label').innerHTML = \`Selected: <span class="text-info">\${hash}</span>\`;
            
            // Automatically query client JSON inventory upon selection
            refreshClientList();
            fetchGateways();
        }

        async function fetchGatewayDetails(hash) {
            try {
                const res = await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'get_gateway_details', gateway_hash: hash })
                });
                const data = await res.json();
                if (data.gateway) {
                    const g = data.gateway;
                    currentTunnelStatus = g.tunnel_status;

                    updateTunnelButtonUI(g.tunnel_status);

                    // Parse pending_output or response if it contains openNDS JSON
                    if (g.pending_output) {
                        try {
                            const parsedJson = JSON.parse(g.pending_output);
                            renderClientsTable(parsedJson);
                        } catch(e) {
                            // If output is plain response text, handle safely or keep inventory if already rendered
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to fetch details', err);
            }
        }

        function refreshClientList() {
            if (!selectedGateway) return;
            sendCommandPayload('ndsctl json');
        }

        function renderClientsTable(jsonData) {
            const tbody = document.getElementById('clients-table-body');
            const clientsObj = jsonData.clients || {};
            const clientKeys = Object.keys(clientsObj);

            if (clientKeys.length === 0) {
                tbody.innerHTML = \`<tr><td colspan="5" class="text-center text-muted py-5">No active clients found in openNDS router table.</td></tr>\`;
                document.getElementById('clients-subtext').innerText = '0 active clients found';
                return;
            }

            document.getElementById('clients-subtext').innerText = \`Total active devices: \${clientKeys.length}\`;

            tbody.innerHTML = clientKeys.map((macKey, index) => {
                const client = clientsObj[macKey];
                const mac = client.mac || macKey;
                const ip = client.ip || 'Unknown IP';
                const clientif = client.clientif || 'br-lan';
                const state = client.state || 'Preauthenticated';
                
                // Check if authenticated (case-insensitive check for robustness)
                const isAuthed = state.toLowerCase() === 'authenticated';

                const badgeClass = isAuthed 
                    ? 'bg-success bg-opacity-10 text-success border border-success border-opacity-25' 
                    : 'bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25';

                return \`
                    <tr>
                        <td>
                            <div class="mac-text">\${mac}</div>
                            <div class="small text-muted"><i class="bi bi-hdd me-1"></i>\${ip}</div>
                        </td>
                        <td><span class="small text-secondary">\${clientif}</span></td>
                        <td>
                            <span class="badge badge-status \${badgeClass}">\${state}</span>
                        </td>
                        <td>
                            \${!isAuthed ? 
                                \`<input type="number" id="mins-\${index}" class="form-control form-control-sleek text-center" value="60" min="1" max="1440">\` : 
                                \`<span class="text-muted small fst-italic">Active session</span>\`
                            }
                        </td>
                        <td class="text-end">
                            \${isAuthed ? 
                                \`<button class="btn btn-sm btn-danger btn-sleek" onclick="deauthClient('\${mac}')">
                                    <i class="bi bi-person-dash me-1"></i> Deauth
                                 </button>\` : 
                                \`<button class="btn btn-sm btn-success btn-sleek" onclick="authClient('\${mac}', 'mins-\${index}')">
                                    <i class="bi bi-person-check me-1"></i> Authenticate
                                 </button>\`
                            }
                        </td>
                    </tr>
                \`;
            }).join('');
        }

        function updateTunnelButtonUI(status) {
            const btn = document.getElementById('tunnel-toggle-btn');
            btn.disabled = false;

            if (status === 0) {
                btn.className = "btn btn-sm btn-outline-warning btn-sleek";
                btn.innerHTML = '<i class="bi bi-shield-exclamation me-1"></i> Request Tunnel';
            } else if (status === 1) {
                btn.className = "btn btn-sm btn-warning text-dark btn-sleek disabled";
                btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Requesting...';
            } else if (status === 2) {
                btn.className = "btn btn-sm btn-danger btn-sleek";
                btn.innerHTML = '<i class="bi bi-shield-check me-1"></i> Disconnect Tunnel';
            }
        }

        async function toggleTunnelStatus() {
            if (!selectedGateway) return;
            let newStatus = (currentTunnelStatus === 0) ? 1 : 0;

            try {
                await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'set_tunnel_status', gateway_hash: selectedGateway, tunnel_status: newStatus })
                });
                fetchGatewayDetails(selectedGateway);
                fetchGateways();
            } catch (err) {
                alert('Failed to update tunnel status');
            }
        }

        function authClient(mac, inputId) {
            const minsInput = document.getElementById(inputId);
            const minutes = minsInput ? minsInput.value : '60';
            // Command format: ndsctl auth MAC MINUTES
            const cmd = \`ndsctl auth \${mac} \${minutes}\`;
            sendCommandPayload(cmd);
        }

        function deauthClient(mac) {
            // Command format: ndsctl deauth MAC
            const cmd = \`ndsctl deauth \${mac}\`;
            sendCommandPayload(cmd);
        }

        function triggerSystemAction(cmd) {
            if (!selectedGateway) return;
            sendCommandPayload(cmd);
        }

        function confirmReboot() {
            if (!selectedGateway) return;
            if (confirm("Are you sure you want to reboot this router gateway?")) {
                sendCommandPayload('reboot');
            }
        }

        async function sendCommandPayload(cmd) {
            try {
                await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'send_command', gateway_hash: selectedGateway, command: cmd })
                });
                fetchGatewayDetails(selectedGateway);
            } catch (err) {
                alert('Error dispatching command to gateway');
            }
        }

        setInterval(fetchGateways, 10000);
        fetchGateways();
    </script>
</body>
</html>`;
}