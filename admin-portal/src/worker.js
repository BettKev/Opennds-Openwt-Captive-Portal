// // --- BHS ADMIN DASHBOARD (PWA + CUMULATIVE TREND + PACKAGE MANAGEMENT + MANUAL PROCESSED EDIT) ---

// export default {
//   async fetch(request, env) {
//     const url = new URL(request.url);

//     // 1. PWA MANIFEST ROUTE
//     if (url.pathname === '/manifest.json') {
//       const manifest = {
//         name: "BHS Admin Pro",
//         short_name: "BHS Admin",
//         description: "Dashboard for BHS Client Sessions",
//         start_url: "/",
//         display: "standalone",
//         background_color: "#0f172a",
//         theme_color: "#3b82f6",
//         icons: [{
//           src: "https://cdn-icons-png.flaticon.com/512/3135/3135706.png",
//           sizes: "512x512",
//           type: "image/png"
//         }]
//       };
//       return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } });
//     }

//     // 2. SERVICE WORKER ROUTE
//     if (url.pathname === '/sw.js') {
//       const swCode = `
//         self.addEventListener('install', (e) => self.skipWaiting());
//         self.addEventListener('fetch', (e) => {
//           e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
//         });
//       `;
//       return new Response(swCode, { headers: { "Content-Type": "application/javascript" } });
//     }

//     // 3. POST ACTIONS (STATUS, PROCESSED & PACKAGE MANAGEMENT)
//     if (request.method === 'POST') {
//       try {
//         const body = await request.json();

//         if (body.action === 'updateStatus') {
//           const newRhid = body.status === 'AUTHENTICATED' ? 'MANUAL_' + Date.now() : null;
//           await env.DB.prepare(`UPDATE client_sessions SET rhid = ? WHERE mac_address = ?`)
//             .bind(newRhid, body.mac)
//             .run();
//           return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
//         }

//         if (body.action === 'updateProcessed') {
//           await env.DB.prepare(`UPDATE payments SET processed = ? WHERE id = ?`)
//             .bind(body.processed ? 1 : 0, body.paymentId)
//             .run();
//           return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
//         }

//         if (body.action === 'addPackage') {
//           await env.DB.prepare(`INSERT INTO packages (name, amount, duration_hours) VALUES (?, ?, ?)`)
//             .bind(body.name, body.amount, body.duration)
//             .run();
//           return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
//         }

//         if (body.action === 'deletePackage') {
//           await env.DB.prepare(`DELETE FROM packages WHERE id = ?`).bind(body.id).run();
//           return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
//         }
//       } catch (e) {
//         return new Response(JSON.stringify({ error: e.message }), { status: 500 });
//       }
//     }

//     const statusFilter = url.searchParams.get('status') || 'all';
//     const deviceFilter = url.searchParams.get('device') || 'all';
//     const minuteFilter = url.searchParams.get('minutes') || 'all';
//     const search = url.searchParams.get('search') || '';
//     const startDate = url.searchParams.get('start') || '';
//     const endDate = url.searchParams.get('end') || '';

//     if (url.searchParams.has('download')) {
//       const data = await getDashboardData(env, 1, statusFilter, deviceFilter, search, startDate, endDate, true, minuteFilter);
//       const csv = jsonToCsv(data.records);
//       return new Response(csv, {
//         headers: {
//           "Content-Type": "text/csv",
//           "Content-Disposition": `attachment; filename="BHS_Export_${new Date().toISOString().split('T')[0]}.csv"`
//         }
//       });
//     }

//     if (url.searchParams.has('api')) {
//       const page = parseInt(url.searchParams.get('page') || '1');
//       const data = await getDashboardData(env, page, statusFilter, deviceFilter, search, startDate, endDate, false, minuteFilter);
//       return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
//     }

//     try {
//       const data = await getDashboardData(env, 1, statusFilter, deviceFilter, search, startDate, endDate, false, minuteFilter);
//       return new Response(generateAdminUI(data, statusFilter, deviceFilter, minuteFilter), { headers: { "Content-Type": "text/html" } });
//     } catch (e) {
//       return new Response("Database Error: " + e.message, { status: 500 });
//     }
//   }
// };

// async function getDashboardData(env, page = 1, statusFilter = 'all', deviceFilter = 'all', search = '', startDate = '', endDate = '', isDownload = false, minuteFilter = 'all') {
//   const limit = 5;
//   const offset = (page - 1) * limit;

//   const { results: locations } = await env.DB.prepare(`SELECT DISTINCT gateway_hash as gatewayname FROM client_sessions WHERE gateway_hash IS NOT NULL`).all();
//   const { results: packages } = await env.DB.prepare(`SELECT * FROM packages ORDER BY created_at DESC`).all();

//   const earnings = await env.DB.prepare(`
//     SELECT 
//       SUM(CASE WHEN created_at >= date('now') THEN amount ELSE 0 END) as daily,
//       SUM(CASE WHEN created_at >= date('now', '-7 days') THEN amount ELSE 0 END) as weekly,
//       SUM(CASE WHEN created_at >= date('now', '-30 days') THEN amount ELSE 0 END) as monthly
//     FROM payments WHERE UPPER(status) = 'PAID'
//   `).first();

//   const { results: cumulativeRevenue } = await env.DB.prepare(`
//     WITH DailyMinuteTotals AS (
//       SELECT strftime('%H:%M', created_at) as time, SUM(amount) as subtotal
//       FROM payments 
//       WHERE UPPER(status) = 'PAID' AND created_at >= date('now')
//       GROUP BY time
//     )
//     SELECT time, SUM(subtotal) OVER (ORDER BY time ASC) as total 
//     FROM DailyMinuteTotals 
//     ORDER BY time ASC
//   `).all();

//   let filterSql = "";
//   let queryParams = [];

//   if (statusFilter !== 'all') {
//       filterSql += statusFilter === 'authenticated' 
//         ? ` AND s.rhid IS NOT NULL AND UPPER(p.status) = 'PAID' AND p.processed = 1` 
//         : ` AND s.rhid IS NULL`;
//   }

//   if (minuteFilter === 'has_minutes') {
//     filterSql += ` AND p.duration_minutes > 0`;
//   } else if (minuteFilter === 'zero_minutes') {
//     filterSql += ` AND (p.duration_minutes <= 0 OR p.duration_minutes IS NULL)`;
//   }
  
//   if (deviceFilter !== 'all' && deviceFilter !== '') { 
//     filterSql += ` AND s.gateway_hash = ?`; 
//     queryParams.push(deviceFilter); 
//   }
//   if (search) {
//     const pattern = `%${search}%`;
//     filterSql += ` AND (s.mac_address LIKE ? OR p.phone LIKE ?)`;
//     queryParams.push(pattern, pattern);
//   }
//   if (startDate) { filterSql += ` AND date(p.created_at) >= ?`; queryParams.push(startDate); }
//   if (endDate) { filterSql += ` AND date(p.created_at) <= ?`; queryParams.push(endDate); }

//   const countQuery = `SELECT COUNT(*) as count FROM client_sessions s INNER JOIN payments p ON s.id = p.session_id WHERE 1=1 ${filterSql}`;
//   const totalCount = await (queryParams.length > 0 ? env.DB.prepare(countQuery).bind(...queryParams).first() : env.DB.prepare(countQuery).first());

//   // ORDER BY prioritization: 1. Active with minutes, 2. Created date
//   let mainQuery = `
//     SELECT 
//       s.mac_address, s.gateway_hash, s.rhid, 
//       p.id as payment_id,
//       p.created_at as session_time, 
//       p.amount, p.status as p_status, p.phone, p.duration_minutes, p.processed
//     FROM client_sessions s 
//     INNER JOIN payments p ON s.id = p.session_id 
//     WHERE 1=1 ${filterSql} 
//     ORDER BY (s.rhid IS NOT NULL AND p.duration_minutes > 0) DESC, p.created_at DESC`;

//   const finalParams = [...queryParams];
//   if (!isDownload) { mainQuery += ` LIMIT ? OFFSET ?`; finalParams.push(limit, offset); }

//   const { results: records } = await (finalParams.length > 0 ? env.DB.prepare(mainQuery).bind(...finalParams).all() : env.DB.prepare(mainQuery).all());

//   return {
//     activeCount: (await env.DB.prepare(`
//     SELECT COUNT(DISTINCT s.mac_address) as c 
//     FROM client_sessions s 
//     INNER JOIN payments p ON s.id = p.session_id 
//     WHERE s.rhid IS NOT NULL 
//       AND UPPER(p.status) = 'PAID' 
//       AND p.duration_minutes > 0 
//       AND p.processed = 1`).first()).c,
//     earnings: { daily: earnings?.daily || 0, weekly: earnings?.weekly || 0, monthly: earnings?.monthly || 0 },
//     chartData: cumulativeRevenue,
//     records,
//     locations,
//     packages,
//     pagination: { page, totalPages: Math.ceil((totalCount?.count || 0) / limit) }
//   };
// }

// function jsonToCsv(items) {
//   if (!items.length) return "";
//   const header = Object.keys(items[0]);
//   return [header.join(','), ...items.map(row => header.map(f => JSON.stringify(row[f] ?? '')).join(','))].join('\r\n');
// }

// function generateAdminUI(data, currentStatus, currentDevice, currentMinuteFilter) {
//   const packageRows = data.packages.map(p => `
//     <tr>
//       <td><strong>${p.name}</strong></td>
//       <td>KES ${p.amount}</td>
//       <td>${p.duration_hours} Hrs</td>
//       <td style="display:flex; justify-content:space-between; align-items:center;">
//         <small style="color:#94a3b8">${p.created_at}</small>
//         <button class="btn" style="background:#ef4444; border:none; padding:4px 8px; color:white; cursor:pointer;" onclick="deletePackage(${p.id})">Delete</button>
//       </td>
//     </tr>
//   `).join('');

//   return `
//   <!DOCTYPE html>
//   <html lang="en">
//   <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>BHS PRO Dashboard</title>
//     <link rel="manifest" href="/manifest.json">
//     <meta name="theme-color" content="#3b82f6">
//     <meta name="apple-mobile-web-app-capable" content="yes">
//     <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//     <style>
//       :root { --primary: #3b82f6; --bg: #0f172a; --surface: #1e293b; --text: #f8fafc; --border: #334155; }
//       body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; margin: 0; }
//       nav { background: #020617; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
//       .container { max-width: 1200px; margin: 1.5rem auto; padding: 0 20px; }
//       .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
//       .stat-card { background: var(--surface); padding: 1.2rem; border-radius: 12px; border: 1px solid var(--border); }
//       .filter-bar { display: flex; gap: 12px; margin-bottom: 1.5rem; flex-wrap: wrap; }
//       .search-input { flex-grow: 1; padding: 0.6rem; border-radius: 8px; border: 1px solid var(--border); background: #0f172a; color: white; }
//       table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 12px; overflow: hidden; }
//       th { background: #263449; text-align: left; padding: 12px; font-size: 0.75rem; color: #94a3b8; }
//       td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
//       .badge { padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: bold; }
//       .status-green { background: rgba(34,197,94,0.2); color: #4ade80; }
//       .status-yellow { background: rgba(245,158,11,0.2); color: #fbbf24; }
//       .pulse { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; display: inline-block; margin-right: 8px; animation: pulse 2s infinite; }
//       @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
//       .btn { padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid var(--border); background: #334155; color: white; cursor: pointer; }
//       .btn-primary { background: var(--primary); border: none; }
//       #installBtn { display: none; margin-right: 15px; background: #10b981; border: none; font-weight: bold; }
//       .tabs { display: flex; gap: 10px; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
//       .tab-btn { background: none; border: none; color: #94a3b8; padding: 10px 15px; cursor: pointer; font-weight: bold; transition: 0.2s; }
//       .tab-btn.active { color: var(--primary); border-bottom: 2px solid var(--primary); }
//       .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: none; justify-content: center; align-items: center; z-index: 1000; }
//       .modal { background: var(--surface); padding: 2rem; border-radius: 15px; width: 420px; border: 1px solid var(--border); }
//       .audio-toggle { font-size: 0.7rem; color: #94a3b8; display: flex; align-items: center; gap: 5px; cursor: pointer; margin-right: 15px;}
//       .form-group { margin-bottom: 1rem; }
//       .form-group label { display: block; margin-bottom: 5px; font-size: 0.8rem; color: #94a3b8; }
//       .form-group input { width: 100%; padding: 8px; border-radius: 6px; background: #0f172a; border: 1px solid var(--border); color: white; box-sizing: border-box; }
//     </style>
//   </head>
//   <body>
//     <nav>
//       <div style="font-weight:bold; letter-spacing:1px;">BHS <span style="color:var(--primary)">ADMIN</span></div>
//       <div style="display:flex; align-items:center;">
//         <button id="installBtn" class="btn btn-primary">📲 Install App</button>
//         <label class="audio-toggle">
//           <input type="checkbox" id="audioEnable" onchange="requestNotifyPermission()"> 🔊 Alerts
//         </label>
//         <span class="pulse"></span>
//         <span id="nav-active" class="badge status-green">${data.activeCount} DEVICES ONLINE</span>
//       </div>
//     </nav>

//     <div class="container">
//       <div class="filter-bar">
//         <input type="text" id="searchInput" class="search-input" placeholder="Search MAC or Phone..." oninput="debounceSearch()">
//         <select id="deviceFilter" onchange="loadPage(1)" class="btn">
//           <option value="all">All Gateways</option>
//           ${data.locations.map(loc => `<option value="${loc.gatewayname}" ${currentDevice === loc.gatewayname ? 'selected' : ''}>${loc.gatewayname}</option>`).join('')}
//         </select>
//         <select id="statusFilter" onchange="loadPage(1)" class="btn">
//           <option value="all" ${currentStatus === 'all' ? 'selected' : ''}>All Status</option>
//           <option value="authenticated" ${currentStatus === 'authenticated' ? 'selected' : ''}>Authenticated</option>
//           <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>Pending</option>
//         </select>
//         <select id="minuteFilter" onchange="loadPage(1)" class="btn">
//           <option value="all" ${currentMinuteFilter === 'all' ? 'selected' : ''}>All Minutes</option>
//           <option value="has_minutes" ${currentMinuteFilter === 'has_minutes' ? 'selected' : ''}>Has Minutes Left</option>
//           <option value="zero_minutes" ${currentMinuteFilter === 'zero_minutes' ? 'selected' : ''}>0 Minutes Left</option>
//         </select>
//         <button class="btn btn-primary" onclick="downloadReport()">Export CSV</button>
//       </div>

//       <div class="tabs">
//         <button id="tab-overview" class="tab-btn active" onclick="switchTab('overview')">Trend (Today)</button>
//         <button id="tab-activity" class="tab-btn" onclick="switchTab('activity')">User Sessions</button>
//         <button id="tab-packages" class="tab-btn" onclick="switchTab('packages')">Price Packages</button>
//       </div>

//       <div id="overview" class="tab-content">
//         <div class="stats-grid">
//           <div class="stat-card"><small>DAILY REVENUE</small><div id="stat-daily">KES ${data.earnings.daily.toLocaleString()}</div></div>
//           <div class="stat-card"><small>WEEKLY REVENUE</small><div id="stat-weekly">KES ${data.earnings.weekly.toLocaleString()}</div></div>
//           <div class="stat-card"><small>MONTHLY REVENUE</small><div id="stat-monthly">KES ${data.earnings.monthly.toLocaleString()}</div></div>
//         </div>
//         <div class="stat-card" style="height:350px"><canvas id="revenueChart"></canvas></div>
//       </div>

//       <div id="activity" class="tab-content" style="display:none">
//         <table>
//           <thead><tr><th>User Info</th><th>Gateway</th><th>Status</th><th>Processed</th><th>Payment & Duration</th><th>Time</th></tr></thead>
//           <tbody id="mainTable"></tbody>
//         </table>
//         <div style="margin-top:1rem; display:flex; justify-content:space-between; align-items:center">
//           <button class="btn" id="prevBtn" onclick="changePage(-1)">Previous</button>
//           <span id="pageInfo" style="color:var(--primary); font-weight:bold"></span>
//           <button class="btn" id="nextBtn" onclick="changePage(1)">Next</button>
//         </div>
//       </div>

//       <div id="packages" class="tab-content" style="display:none">
//         <div style="display:flex; justify-content:space-between; margin-bottom:1.5rem">
//           <h3 style="margin:0">Available Packages</h3>
//           <button class="btn btn-primary" onclick="openAddPackageModal()">+ New Package</button>
//         </div>
//         <table>
//           <thead><tr><th>Name</th><th>Price</th><th>Duration</th><th>Action</th></tr></thead>
//           <tbody id="packageTable">${packageRows}</tbody>
//         </table>
//       </div>
//     </div>

//     <div id="packageModal" class="modal-overlay" onclick="this.style.display='none'">
//       <div class="modal" onclick="event.stopPropagation()">
//         <h3 style="color:var(--primary); margin-top:0">Add New Package</h3>
//         <div class="form-group">
//           <label>Package Name (e.g. 1 Hour High Speed)</label>
//           <input type="text" id="pkgName" placeholder="Enter name">
//         </div>
//         <div class="form-group">
//           <label>Amount (KES)</label>
//           <input type="number" id="pkgAmount" placeholder="e.g. 20">
//         </div>
//         <div class="form-group">
//           <label>Duration (Hours)</label>
//           <input type="number" id="pkgDuration" placeholder="e.g. 1">
//         </div>
//         <button class="btn btn-primary" style="width:100%; margin-top:10px;" onclick="submitNewPackage()">Save Package</button>
//         <button class="btn" style="width:100%; margin-top:10px;" onclick="document.getElementById('packageModal').style.display='none'">Cancel</button>
//       </div>
//     </div>

//     <div id="detailModal" class="modal-overlay" onclick="this.style.display='none'">
//       <div class="modal" onclick="event.stopPropagation()">
//         <h3 id="modalTitle" style="color:var(--primary); margin-top:0">Session Details</h3>
//         <div id="modalContent" style="line-height:1.8"></div>
//         <div id="modalActions" style="margin-top:2rem; display: flex; flex-direction: column; gap: 10px;"></div>
//         <button class="btn" style="width:100%; margin-top:10px;" onclick="document.getElementById('detailModal').style.display='none'">Close</button>
//       </div>
//     </div>

//     <script>
//       let currentPage = 1;
//       let myChart;
//       let searchTimeout;
//       let activeTab = 'overview';
//       let lastDailyTotal = ${data.earnings.daily};
//       let deferredPrompt;

//       function openAddPackageModal() { document.getElementById('packageModal').style.display = 'flex'; }

//       async function submitNewPackage() {
//         const name = document.getElementById('pkgName').value;
//         const amount = document.getElementById('pkgAmount').value;
//         const duration = document.getElementById('pkgDuration').value;
//         if(!name || !amount || !duration) return alert("Please fill all fields");
//         const res = await fetch(location.href, {
//           method: 'POST',
//           body: JSON.stringify({ action: 'addPackage', name, amount, duration })
//         });
//         if(res.ok) location.reload();
//       }

//       async function deletePackage(id) {
//         if(!confirm("Are you sure you want to delete this package?")) return;
//         const res = await fetch(location.href, {
//           method: 'POST',
//           body: JSON.stringify({ action: 'deletePackage', id })
//         });
//         if(res.ok) location.reload();
//       }

//       if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); }); }

//       window.addEventListener('beforeinstallprompt', (e) => {
//         e.preventDefault(); deferredPrompt = e;
//         document.getElementById('installBtn').style.display = 'block';
//       });

//       document.getElementById('installBtn').addEventListener('click', async () => {
//         if (!deferredPrompt) return;
//         deferredPrompt.prompt();
//         const { outcome } = await deferredPrompt.userChoice;
//         if (outcome === 'accepted') document.getElementById('installBtn').style.display = 'none';
//         deferredPrompt = null;
//       });

//       function requestNotifyPermission() { if (Notification.permission !== "granted") Notification.requestPermission(); }

//       async function playAlert() {
//         if (!document.getElementById('audioEnable').checked) return;
//         const ctx = new (window.AudioContext || window.webkitAudioContext)();
//         const beep = (freq, time) => {
//           const osc = ctx.createOscillator(); const gain = ctx.createGain();
//           osc.connect(gain); gain.connect(ctx.destination);
//           osc.type = 'sine'; osc.frequency.setValueAtTime(freq, ctx.currentTime + time);
//           gain.gain.setValueAtTime(0, ctx.currentTime + time);
//           gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + time + 0.05);
//           gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + time + 0.2);
//           osc.start(ctx.currentTime + time); osc.stop(ctx.currentTime + time + 0.2);
//         };
//         beep(880, 0); beep(1100, 0.25);
//       }

//       function sendNotification(amount) {
//         if (Notification.permission === "granted") {
//           new Notification("New Payment Received!", {
//             body: \`Daily Total: KES \${amount.toLocaleString()}\`,
//             icon: "https://cdn-icons-png.flaticon.com/512/3135/3135706.png"
//           });
//         }
//       }

//       async function loadPage(page) {
//         currentPage = page;
//         const status = document.getElementById('statusFilter').value;
//         const device = document.getElementById('deviceFilter').value;
//         const minutes = document.getElementById('minuteFilter').value;
//         const search = encodeURIComponent(document.getElementById('searchInput').value);
        
//         const res = await fetch(\`?api=true&page=\${page}&status=\${status}&device=\${device}&minutes=\${minutes}&search=\${search}\`);
//         const data = await res.json();
        
//         if (data.earnings.daily > lastDailyTotal) {
//           playAlert();
//           sendNotification(data.earnings.daily);
//           lastDailyTotal = data.earnings.daily;
//         }

//         document.getElementById('nav-active').innerText = data.activeCount + ' DEVICES ONLINE';

//         if (activeTab === 'activity') {
//           document.getElementById('mainTable').innerHTML = data.records.map(r => {
//             const duration = r.duration_minutes ? \` (\${r.duration_minutes} min)\` : ' (0 min)';
//             const hasTime = r.duration_minutes > 0;
//             return \`
//               <tr onclick="openRecord('\${btoa(unescape(encodeURIComponent(JSON.stringify(r))))}')" style="cursor:pointer">
//                 <td><strong>\${r.phone || 'Guest'}</strong><br><small style="color:#94a3b8">\${r.mac_address}</small></td>
//                 <td><small>\${r.gateway_hash || '—'}</small></td>
//                 <td><span class="badge \${r.rhid ? 'status-green' : 'status-yellow'}">\${r.rhid ? 'ACTIVE' : 'PENDING'}</span></td>
//                 <td><span class="badge \${r.processed ? 'status-green' : 'status-yellow'}">\${r.processed ? 'PROCESSED' : 'PENDING'}</span></td>
//                 <td><strong>\${r.amount ? 'KES '+r.amount : '—'}</strong><br><small style="color:\${hasTime ? 'var(--primary)' : '#ef4444'}">\${duration}</small></td>
//                 <td>\${new Date(r.session_time).toLocaleString()}</td>
//               </tr>\`;
//           }).join('');
//           document.getElementById('pageInfo').innerText = \`Page \${currentPage} of \${data.pagination.totalPages || 1}\`;
//           document.getElementById('prevBtn').disabled = currentPage <= 1;
//           document.getElementById('nextBtn').disabled = currentPage >= (data.pagination.totalPages || 1);
//         }

//         if (activeTab === 'overview') {
//             document.getElementById('stat-daily').innerText = 'KES ' + data.earnings.daily.toLocaleString();
//             document.getElementById('stat-weekly').innerText = 'KES ' + data.earnings.weekly.toLocaleString();
//             document.getElementById('stat-monthly').innerText = 'KES ' + data.earnings.monthly.toLocaleString();
//             initChart(data.chartData);
//         }
//       }

//       function switchTab(id) {
//         activeTab = id;
//         document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
//         document.getElementById(id).style.display = 'block';
//         document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
//         document.getElementById('tab-' + id).classList.add('active');
//         if(id !== 'packages') loadPage(1);
//       }

//       function debounceSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => loadPage(1), 500); }
//       function changePage(step) { loadPage(currentPage + step); }

//       function openRecord(b64) {
//         const r = JSON.parse(decodeURIComponent(escape(atob(b64))));
//         document.getElementById('modalContent').innerHTML = \`
//           <div><strong>MAC:</strong> \${r.mac_address}</div>
//           <div><strong>Phone:</strong> \${r.phone || 'N/A'}</div>
//           <div><strong>Paid Duration:</strong> \${r.duration_minutes || 0} Minutes</div>
//           <div><strong>Payment Status:</strong> \${r.p_status || 'Unknown'}</div>
//           <div><strong>Processed:</strong> <span class="badge \${r.processed ? 'status-green' : 'status-yellow'}">\${r.processed ? 'PROCESSED' : 'PENDING'}</span></div>
//           <div><strong>Payment Time:</strong> \${new Date(r.session_time).toLocaleString()}</div>
//           <div style="margin-top:10px; padding:10px; background:#0f172a; border-radius:8px; font-size:0.75rem; word-break:break-all">
//             <strong>Token (rhid):</strong><br>\${r.rhid || 'None'}
//           </div>\`;
        
//         document.getElementById('modalActions').innerHTML = \`
//           <button class="btn \${r.rhid ? 'btn' : 'btn-primary'}" onclick="updateStatus('\${r.mac_address}', '\${r.rhid ? 'PENDING' : 'AUTHENTICATED'}')">
//             \${r.rhid ? 'Deauthenticate' : 'Manual Authenticate'}
//           </button>
//           <button class="btn \${r.processed ? '' : 'btn-primary'}" onclick="updateProcessedStatus(\${r.payment_id}, \${!r.processed})">
//             \${r.processed ? 'Mark as Pending' : 'Mark as Processed'}
//           </button>\`;
//         document.getElementById('detailModal').style.display = 'flex';
//       }

//       async function updateStatus(mac, status) {
//         const res = await fetch(location.href, { method: 'POST', body: JSON.stringify({ action: 'updateStatus', mac, status })});
//         if(res.ok) {
//            loadPage(currentPage);
//            document.getElementById('detailModal').style.display = 'none';
//         }
//       }

//       async function updateProcessedStatus(paymentId, processed) {
//         const res = await fetch(location.href, { 
//           method: 'POST', 
//           body: JSON.stringify({ action: 'updateProcessed', paymentId, processed })
//         });
//         if(res.ok) {
//           loadPage(currentPage);
//           document.getElementById('detailModal').style.display = 'none';
//         }
//       }

//       function initChart(data) {
//         const ctx = document.getElementById('revenueChart').getContext('2d');
//         if(myChart) myChart.destroy();
//         myChart = new Chart(ctx, {
//           type: 'line',
//           data: {
//             labels: data.map(d => d.time),
//             datasets: [{ 
//               label: 'Cumulative Revenue', 
//               data: data.map(d => d.total), 
//               borderColor: '#3b82f6', 
//               borderWidth: 3,
//               tension: 0.1, 
//               fill: true, 
//               pointRadius: 0,
//               backgroundColor: 'rgba(59,130,246,0.2)' 
//             }]
//           },
//           options: { 
//             responsive: true, 
//             maintainAspectRatio: false, 
//             plugins: { 
//                 legend: { display: false },
//                 tooltip: {
//                     mode: 'index',
//                     intersect: false,
//                     callbacks: {
//                         label: function(context) { return 'Cumulative: KES ' + context.parsed.y.toLocaleString(); }
//                     }
//                 }
//             },
//             scales: {
//               x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 12 } },
//               y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' }, beginAtZero: true }
//             }
//           }
//         });
//       }

//       function downloadReport() {
//         const status = document.getElementById('statusFilter').value;
//         const device = document.getElementById('deviceFilter').value;
//         const minutes = document.getElementById('minuteFilter').value;
//         window.location.href = \`?download=true&status=\${status}&device=\${device}&minutes=\${minutes}\`;
//       }

//       setInterval(() => { if(activeTab !== 'packages') loadPage(currentPage); }, 30000);
//       loadPage(1);
//     </script>
//   </body>
//   </html>`;
// }


// --- BHS ADMIN DASHBOARD (PWA + CUMULATIVE TREND + PACKAGE MANAGEMENT + MANUAL PROCESSED EDIT) ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. PWA MANIFEST ROUTE
    if (url.pathname === '/manifest.json') {
      const manifest = {
        name: "BHS Admin Pro",
        short_name: "BHS Admin",
        description: "Dashboard for BHS Client Sessions",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#3b82f6",
        icons: [{
          src: "https://cdn-icons-png.flaticon.com/512/3135/3135706.png",
          sizes: "512x512",
          type: "image/png"
        }]
      };
      return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } });
    }

    // 2. SERVICE WORKER ROUTE
    if (url.pathname === '/sw.js') {
      const swCode = `
        self.addEventListener('install', (e) => self.skipWaiting());
        self.addEventListener('fetch', (e) => {
          e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        });
      `;
      return new Response(swCode, { headers: { "Content-Type": "application/javascript" } });
    }

    // 3. POST ACTIONS (STATUS, PROCESSED & PACKAGE MANAGEMENT)
    if (request.method === 'POST') {
      try {
        const body = await request.json();

        if (body.action === 'updateStatus') {
          const newRhid = body.status === 'AUTHENTICATED' ? 'MANUAL_' + Date.now() : null;
          await env.DB.prepare(`UPDATE client_sessions SET rhid = ? WHERE mac_address = ?`)
            .bind(newRhid, body.mac)
            .run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }

        if (body.action === 'updateProcessed') {
          await env.DB.prepare(`UPDATE payments SET processed = ? WHERE id = ?`)
            .bind(body.processed ? 1 : 0, body.paymentId)
            .run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }

        if (body.action === 'addPackage') {
          await env.DB.prepare(`INSERT INTO packages (name, amount, duration_hours) VALUES (?, ?, ?)`)
            .bind(body.name, body.amount, body.duration)
            .run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }

        if (body.action === 'deletePackage') {
          await env.DB.prepare(`DELETE FROM packages WHERE id = ?`).bind(body.id).run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    const statusFilter = url.searchParams.get('status') || 'all';
    const deviceFilter = url.searchParams.get('device') || 'all';
    const minuteFilter = url.searchParams.get('minutes') || 'all';
    const search = url.searchParams.get('search') || '';
    const startDate = url.searchParams.get('start') || '';
    const endDate = url.searchParams.get('end') || '';

    if (url.searchParams.has('download')) {
      const data = await getDashboardData(env, 1, statusFilter, deviceFilter, search, startDate, endDate, true, minuteFilter);
      const csv = jsonToCsv(data.records);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="BHS_Export_${new Date().toISOString().split('T')[0]}.csv"`
        }
      });
    }

    if (url.searchParams.has('api')) {
      const page = parseInt(url.searchParams.get('page') || '1');
      const data = await getDashboardData(env, page, statusFilter, deviceFilter, search, startDate, endDate, false, minuteFilter);
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    }

    try {
      const data = await getDashboardData(env, 1, statusFilter, deviceFilter, search, startDate, endDate, false, minuteFilter);
      return new Response(generateAdminUI(data, statusFilter, deviceFilter, minuteFilter), { headers: { "Content-Type": "text/html" } });
    } catch (e) {
      return new Response("Database Error: " + e.message, { status: 500 });
    }
  }
};

async function getDashboardData(env, page = 1, statusFilter = 'all', deviceFilter = 'all', search = '', startDate = '', endDate = '', isDownload = false, minuteFilter = 'all') {
  const limit = 5;
  const offset = (page - 1) * limit;

  const { results: locations } = await env.DB.prepare(`SELECT DISTINCT gateway_hash as gatewayname FROM client_sessions WHERE gateway_hash IS NOT NULL`).all();
  const { results: packages } = await env.DB.prepare(`SELECT * FROM packages ORDER BY created_at DESC`).all();

  const earnings = await env.DB.prepare(`
    SELECT 
      SUM(CASE WHEN created_at >= date('now') THEN amount ELSE 0 END) as daily,
      SUM(CASE WHEN created_at >= date('now', '-7 days') THEN amount ELSE 0 END) as weekly,
      SUM(CASE WHEN created_at >= date('now', '-30 days') THEN amount ELSE 0 END) as monthly
    FROM payments WHERE UPPER(status) = 'PAID'
  `).first();

  // --- CHART LOGIC: MULTI-SCALE TRENDS ---
  const dailyQuery = await env.DB.prepare(`
    WITH DailyMinuteTotals AS (
      SELECT strftime('%H:00', created_at) as time, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now') GROUP BY time
    )
    SELECT time, SUM(subtotal) OVER (ORDER BY time ASC) as total FROM DailyMinuteTotals ORDER BY time ASC
  `).all();

  const weeklyQuery = await env.DB.prepare(`
    WITH WeeklyTotals AS (
      SELECT date(created_at) as time, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now', '-7 days') GROUP BY time
    )
    SELECT time, SUM(subtotal) OVER (ORDER BY time ASC) as total FROM WeeklyTotals ORDER BY time ASC
  `).all();

  const monthlyQuery = await env.DB.prepare(`
    WITH MonthlyTotals AS (
      SELECT date(created_at) as time, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now', '-30 days') GROUP BY time
    )
    SELECT time, SUM(subtotal) OVER (ORDER BY time ASC) as total FROM MonthlyTotals ORDER BY time ASC
  `).all();

  // --- MINUTE USAGE CHART LOGIC ---
  const minuteTrend = await env.DB.prepare(`
    SELECT strftime('%H:00', created_at) as time, SUM(duration_minutes) as total_mins
    FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now') GROUP BY time ORDER BY time ASC
  `).all();

  let filterSql = "";
  let queryParams = [];

  if (statusFilter !== 'all') {
      filterSql += statusFilter === 'authenticated' 
        ? ` AND s.rhid IS NOT NULL AND UPPER(p.status) = 'PAID' AND p.processed = 1` 
        : ` AND s.rhid IS NULL`;
  }

  if (minuteFilter === 'has_minutes') {
    filterSql += ` AND p.duration_minutes > 0`;
  } else if (minuteFilter === 'zero_minutes') {
    filterSql += ` AND (p.duration_minutes <= 0 OR p.duration_minutes IS NULL)`;
  }
  
  if (deviceFilter !== 'all' && deviceFilter !== '') { 
    filterSql += ` AND s.gateway_hash = ?`; 
    queryParams.push(deviceFilter); 
  }
  if (search) {
    const pattern = `%${search}%`;
    filterSql += ` AND (s.mac_address LIKE ? OR p.phone LIKE ?)`;
    queryParams.push(pattern, pattern);
  }
  if (startDate) { filterSql += ` AND date(p.created_at) >= ?`; queryParams.push(startDate); }
  if (endDate) { filterSql += ` AND date(p.created_at) <= ?`; queryParams.push(endDate); }

  const countQuery = `SELECT COUNT(*) as count FROM client_sessions s INNER JOIN payments p ON s.id = p.session_id WHERE 1=1 ${filterSql}`;
  const totalCount = await (queryParams.length > 0 ? env.DB.prepare(countQuery).bind(...queryParams).first() : env.DB.prepare(countQuery).first());

  let mainQuery = `
    SELECT 
      s.mac_address, s.gateway_hash, s.rhid, 
      p.id as payment_id,
      p.created_at as session_time, 
      p.amount, p.status as p_status, p.phone, p.duration_minutes, p.processed
    FROM client_sessions s 
    INNER JOIN payments p ON s.id = p.session_id 
    WHERE 1=1 ${filterSql} 
    ORDER BY (s.rhid IS NOT NULL AND p.duration_minutes > 0) DESC, p.created_at DESC`;

  const finalParams = [...queryParams];
  if (!isDownload) { mainQuery += ` LIMIT ? OFFSET ?`; finalParams.push(limit, offset); }

  const { results: records } = await (finalParams.length > 0 ? env.DB.prepare(mainQuery).bind(...finalParams).all() : env.DB.prepare(mainQuery).all());

  return {
    activeCount: (await env.DB.prepare(`
    SELECT COUNT(DISTINCT s.mac_address) as c 
    FROM client_sessions s 
    INNER JOIN payments p ON s.id = p.session_id 
    WHERE s.rhid IS NOT NULL 
      AND UPPER(p.status) = 'PAID' 
      AND p.duration_minutes > 0 
      AND p.processed = 1`).first()).c,
    earnings: { daily: earnings?.daily || 0, weekly: earnings?.weekly || 0, monthly: earnings?.monthly || 0 },
    chartData: {
      daily: dailyQuery.results,
      weekly: weeklyQuery.results,
      monthly: monthlyQuery.results,
      minuteTrend: minuteTrend.results
    },
    records,
    locations,
    packages,
    pagination: { page, totalPages: Math.ceil((totalCount?.count || 0) / limit) }
  };
}

function jsonToCsv(items) {
  if (!items.length) return "";
  const header = Object.keys(items[0]);
  return [header.join(','), ...items.map(row => header.map(f => JSON.stringify(row[f] ?? '')).join(','))].join('\r\n');
}

function generateAdminUI(data, currentStatus, currentDevice, currentMinuteFilter) {
  const packageRows = data.packages.map(p => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>KES ${p.amount}</td>
      <td>${p.duration_hours} Hrs</td>
      <td style="display:flex; justify-content:space-between; align-items:center;">
        <small style="color:#94a3b8">${p.created_at}</small>
        <button class="btn" style="background:#ef4444; border:none; padding:4px 8px; color:white; cursor:pointer;" onclick="deletePackage(${p.id})">Delete</button>
      </td>
    </tr>
  `).join('');

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BHS PRO Dashboard</title>
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#3b82f6">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
      :root { --primary: #3b82f6; --bg: #0f172a; --surface: #1e293b; --text: #f8fafc; --border: #334155; }
      body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; margin: 0; }
      nav { background: #020617; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
      .container { max-width: 1200px; margin: 1.5rem auto; padding: 0 20px; }
      .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
      .stat-card { background: var(--surface); padding: 1.2rem; border-radius: 12px; border: 1px solid var(--border); position: relative; }
      .filter-bar { display: flex; gap: 12px; margin-bottom: 1.5rem; flex-wrap: wrap; }
      .search-input { flex-grow: 1; padding: 0.6rem; border-radius: 8px; border: 1px solid var(--border); background: #0f172a; color: white; }
      table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 12px; overflow: hidden; }
      th { background: #263449; text-align: left; padding: 12px; font-size: 0.75rem; color: #94a3b8; }
      td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
      .badge { padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: bold; }
      .status-green { background: rgba(34,197,94,0.2); color: #4ade80; }
      .status-yellow { background: rgba(245,158,11,0.2); color: #fbbf24; }
      .pulse { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; display: inline-block; margin-right: 8px; animation: pulse 2s infinite; }
      @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
      .btn { padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid var(--border); background: #334155; color: white; cursor: pointer; }
      .btn-primary { background: var(--primary); border: none; }
      #installBtn { display: none; margin-right: 15px; background: #10b981; border: none; font-weight: bold; }
      .tabs { display: flex; gap: 10px; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
      .tab-btn { background: none; border: none; color: #94a3b8; padding: 10px 15px; cursor: pointer; font-weight: bold; transition: 0.2s; }
      .tab-btn.active { color: var(--primary); border-bottom: 2px solid var(--primary); }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: none; justify-content: center; align-items: center; z-index: 1000; }
      .modal { background: var(--surface); padding: 2rem; border-radius: 15px; width: 420px; border: 1px solid var(--border); }
      .audio-toggle { font-size: 0.7rem; color: #94a3b8; display: flex; align-items: center; gap: 5px; cursor: pointer; margin-right: 15px;}
      .form-group { margin-bottom: 1rem; }
      .form-group label { display: block; margin-bottom: 5px; font-size: 0.8rem; color: #94a3b8; }
      .form-group input { width: 100%; padding: 8px; border-radius: 6px; background: #0f172a; border: 1px solid var(--border); color: white; box-sizing: border-box; }
      .chart-toggle-group { position: absolute; top: 1rem; right: 1rem; display: flex; gap: 5px; z-index: 10; }
      .chart-toggle-btn { padding: 4px 10px; font-size: 0.7rem; border-radius: 6px; border: 1px solid var(--border); background: #0f172a; color: #94a3b8; cursor: pointer; }
      .chart-toggle-btn.active { background: var(--primary); color: white; border: none; }
      .charts-wrapper { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1rem; }
    </style>
  </head>
  <body>
    <nav>
      <div style="font-weight:bold; letter-spacing:1px;">BHS <span style="color:var(--primary)">ADMIN</span></div>
      <div style="display:flex; align-items:center;">
        <button id="installBtn" class="btn btn-primary">📲 Install App</button>
        <label class="audio-toggle">
          <input type="checkbox" id="audioEnable" onchange="requestNotifyPermission()"> 🔊 Alerts
        </label>
        <span class="pulse"></span>
        <span id="nav-active" class="badge status-green">${data.activeCount} DEVICES ONLINE</span>
      </div>
    </nav>

    <div class="container">
      <div class="filter-bar">
        <input type="text" id="searchInput" class="search-input" placeholder="Search MAC or Phone..." oninput="debounceSearch()">
        <select id="deviceFilter" onchange="loadPage(1)" class="btn">
          <option value="all">All Gateways</option>
          ${data.locations.map(loc => `<option value="${loc.gatewayname}" ${currentDevice === loc.gatewayname ? 'selected' : ''}>${loc.gatewayname}</option>`).join('')}
        </select>
        <select id="statusFilter" onchange="loadPage(1)" class="btn">
          <option value="all" ${currentStatus === 'all' ? 'selected' : ''}>All Status</option>
          <option value="authenticated" ${currentStatus === 'authenticated' ? 'selected' : ''}>Authenticated</option>
          <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>Pending</option>
        </select>
        <select id="minuteFilter" onchange="loadPage(1)" class="btn">
          <option value="all" ${currentMinuteFilter === 'all' ? 'selected' : ''}>All Minutes</option>
          <option value="has_minutes" ${currentMinuteFilter === 'has_minutes' ? 'selected' : ''}>Has Minutes Left</option>
          <option value="zero_minutes" ${currentMinuteFilter === 'zero_minutes' ? 'selected' : ''}>0 Minutes Left</option>
        </select>
        <button class="btn btn-primary" onclick="downloadReport()">Export CSV</button>
      </div>

      <div class="tabs">
        <button id="tab-overview" class="tab-btn active" onclick="switchTab('overview')">Insights</button>
        <button id="tab-activity" class="tab-btn" onclick="switchTab('activity')">User Sessions</button>
        <button id="tab-packages" class="tab-btn" onclick="switchTab('packages')">Price Packages</button>
      </div>

      <div id="overview" class="tab-content">
        <div class="stats-grid">
          <div class="stat-card"><small>DAILY REVENUE</small><div id="stat-daily">KES ${data.earnings.daily.toLocaleString()}</div></div>
          <div class="stat-card"><small>WEEKLY REVENUE</small><div id="stat-weekly">KES ${data.earnings.weekly.toLocaleString()}</div></div>
          <div class="stat-card"><small>MONTHLY REVENUE</small><div id="stat-monthly">KES ${data.earnings.monthly.toLocaleString()}</div></div>
        </div>
        <div class="charts-wrapper">
            <div class="stat-card" style="height:350px">
              <div class="chart-toggle-group">
                <button class="chart-toggle-btn active" onclick="setChartRange('daily')">Daily</button>
                <button class="chart-toggle-btn" onclick="setChartRange('weekly')">Weekly</button>
                <button class="chart-toggle-btn" onclick="setChartRange('monthly')">Monthly</button>
              </div>
              <canvas id="revenueChart"></canvas>
            </div>
            <div class="stat-card" style="height:350px">
                <small style="color:#94a3b8; position:absolute; top:1rem; left:1rem; font-weight:bold;">MINUTE USAGE (24H)</small>
                <canvas id="minuteChart"></canvas>
            </div>
        </div>
      </div>

      <div id="activity" class="tab-content" style="display:none">
        <table>
          <thead><tr><th>User Info</th><th>Gateway</th><th>Status</th><th>Processed</th><th>Payment & Duration</th><th>Time</th></tr></thead>
          <tbody id="mainTable"></tbody>
        </table>
        <div style="margin-top:1rem; display:flex; justify-content:space-between; align-items:center">
          <button class="btn" id="prevBtn" onclick="changePage(-1)">Previous</button>
          <span id="pageInfo" style="color:var(--primary); font-weight:bold"></span>
          <button class="btn" id="nextBtn" onclick="changePage(1)">Next</button>
        </div>
      </div>

      <div id="packages" class="tab-content" style="display:none">
        <div style="display:flex; justify-content:space-between; margin-bottom:1.5rem">
          <h3 style="margin:0">Available Packages</h3>
          <button class="btn btn-primary" onclick="openAddPackageModal()">+ New Package</button>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Price</th><th>Duration</th><th>Action</th></tr></thead>
          <tbody id="packageTable">${packageRows}</tbody>
        </table>
      </div>
    </div>

    <div id="packageModal" class="modal-overlay" onclick="this.style.display='none'">
      <div class="modal" onclick="event.stopPropagation()">
        <h3 style="color:var(--primary); margin-top:0">Add New Package</h3>
        <div class="form-group">
          <label>Package Name (e.g. 1 Hour High Speed)</label>
          <input type="text" id="pkgName" placeholder="Enter name">
        </div>
        <div class="form-group">
          <label>Amount (KES)</label>
          <input type="number" id="pkgAmount" placeholder="e.g. 20">
        </div>
        <div class="form-group">
          <label>Duration (Hours)</label>
          <input type="number" id="pkgDuration" placeholder="e.g. 1">
        </div>
        <button class="btn btn-primary" style="width:100%; margin-top:10px;" onclick="submitNewPackage()">Save Package</button>
        <button class="btn" style="width:100%; margin-top:10px;" onclick="document.getElementById('packageModal').style.display='none'">Cancel</button>
      </div>
    </div>

    <div id="detailModal" class="modal-overlay" onclick="this.style.display='none'">
      <div class="modal" onclick="event.stopPropagation()">
        <h3 id="modalTitle" style="color:var(--primary); margin-top:0">Session Details</h3>
        <div id="modalContent" style="line-height:1.8"></div>
        <div id="modalActions" style="margin-top:2rem; display: flex; flex-direction: column; gap: 10px;"></div>
        <button class="btn" style="width:100%; margin-top:10px;" onclick="document.getElementById('detailModal').style.display='none'">Close</button>
      </div>
    </div>

    <script>
      let currentPage = 1;
      let myChart, myMinChart;
      let searchTimeout;
      let activeTab = 'overview';
      let chartRange = 'daily';
      let chartDataMaster = ${JSON.stringify(data.chartData)};
      let lastDailyTotal = ${data.earnings.daily};
      let deferredPrompt;

      function openAddPackageModal() { document.getElementById('packageModal').style.display = 'flex'; }

      async function submitNewPackage() {
        const name = document.getElementById('pkgName').value;
        const amount = document.getElementById('pkgAmount').value;
        const duration = document.getElementById('pkgDuration').value;
        if(!name || !amount || !duration) return alert("Please fill all fields");
        const res = await fetch(location.href, {
          method: 'POST',
          body: JSON.stringify({ action: 'addPackage', name, amount, duration })
        });
        if(res.ok) location.reload();
      }

      async function deletePackage(id) {
        if(!confirm("Are you sure you want to delete this package?")) return;
        const res = await fetch(location.href, {
          method: 'POST',
          body: JSON.stringify({ action: 'deletePackage', id })
        });
        if(res.ok) location.reload();
      }

      if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); }); }

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); deferredPrompt = e;
        document.getElementById('installBtn').style.display = 'block';
      });

      document.getElementById('installBtn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') document.getElementById('installBtn').style.display = 'none';
        deferredPrompt = null;
      });

      function requestNotifyPermission() { if (Notification.permission !== "granted") Notification.requestPermission(); }

      async function playAlert() {
        if (!document.getElementById('audioEnable').checked) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const beep = (freq, time) => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine'; osc.frequency.setValueAtTime(freq, ctx.currentTime + time);
          gain.gain.setValueAtTime(0, ctx.currentTime + time);
          gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + time + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + time + 0.2);
          osc.start(ctx.currentTime + time); osc.stop(ctx.currentTime + time + 0.2);
        };
        beep(880, 0); beep(1100, 0.25);
      }

      function sendNotification(amount) {
        if (Notification.permission === "granted") {
          new Notification("New Payment Received!", {
            body: \`Daily Total: KES \${amount.toLocaleString()}\`,
            icon: "https://cdn-icons-png.flaticon.com/512/3135/3135706.png"
          });
        }
      }

      function setChartRange(range) {
        chartRange = range;
        document.querySelectorAll('.chart-toggle-btn').forEach(btn => {
          btn.classList.toggle('active', btn.innerText.toLowerCase() === range);
        });
        initChart(chartDataMaster[range]);
      }

      async function loadPage(page) {
        currentPage = page;
        const status = document.getElementById('statusFilter').value;
        const device = document.getElementById('deviceFilter').value;
        const minutes = document.getElementById('minuteFilter').value;
        const search = encodeURIComponent(document.getElementById('searchInput').value);
        
        const res = await fetch(\`?api=true&page=\${page}&status=\${status}&device=\${device}&minutes=\${minutes}&search=\${search}\`);
        const data = await res.json();
        
        chartDataMaster = data.chartData;
        
        if (data.earnings.daily > lastDailyTotal) {
          playAlert();
          sendNotification(data.earnings.daily);
          lastDailyTotal = data.earnings.daily;
        }

        document.getElementById('nav-active').innerText = data.activeCount + ' DEVICES ONLINE';

        if (activeTab === 'activity') {
          document.getElementById('mainTable').innerHTML = data.records.map(r => {
            const duration = r.duration_minutes ? \` (\${r.duration_minutes} min)\` : ' (0 min)';
            const hasTime = r.duration_minutes > 0;
            return \`
              <tr onclick="openRecord('\${btoa(unescape(encodeURIComponent(JSON.stringify(r))))}')" style="cursor:pointer">
                <td><strong>\${r.phone || 'Guest'}</strong><br><small style="color:#94a3b8">\${r.mac_address}</small></td>
                <td><small>\${r.gateway_hash || '—'}</small></td>
                <td><span class="badge \${r.rhid ? 'status-green' : 'status-yellow'}">\${r.rhid ? 'ACTIVE' : 'PENDING'}</span></td>
                <td><span class="badge \${r.processed ? 'status-green' : 'status-yellow'}">\${r.processed ? 'PROCESSED' : 'PENDING'}</span></td>
                <td><strong>\${r.amount ? 'KES '+r.amount : '—'}</strong><br><small style="color:\${hasTime ? 'var(--primary)' : '#ef4444'}">\${duration}</small></td>
                <td>\${new Date(r.session_time).toLocaleString()}</td>
              </tr>\`;
          }).join('');
          document.getElementById('pageInfo').innerText = \`Page \${currentPage} of \${data.pagination.totalPages || 1}\`;
          document.getElementById('prevBtn').disabled = currentPage <= 1;
          document.getElementById('nextBtn').disabled = currentPage >= (data.pagination.totalPages || 1);
        }

        if (activeTab === 'overview') {
            document.getElementById('stat-daily').innerText = 'KES ' + data.earnings.daily.toLocaleString();
            document.getElementById('stat-weekly').innerText = 'KES ' + data.earnings.weekly.toLocaleString();
            document.getElementById('stat-monthly').innerText = 'KES ' + data.earnings.monthly.toLocaleString();
            initChart(chartDataMaster[chartRange]);
            initMinuteChart(chartDataMaster.minuteTrend);
        }
      }

      function switchTab(id) {
        activeTab = id;
        document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
        document.getElementById(id).style.display = 'block';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
        if(id !== 'packages') loadPage(1);
      }

      function debounceSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => loadPage(1), 500); }
      function changePage(step) { loadPage(currentPage + step); }

      function openRecord(b64) {
        const r = JSON.parse(decodeURIComponent(escape(atob(b64))));
        document.getElementById('modalContent').innerHTML = \`
          <div><strong>MAC:</strong> \${r.mac_address}</div>
          <div><strong>Phone:</strong> \${r.phone || 'N/A'}</div>
          <div><strong>Paid Duration:</strong> \${r.duration_minutes || 0} Minutes</div>
          <div><strong>Payment Status:</strong> \${r.p_status || 'Unknown'}</div>
          <div><strong>Processed:</strong> <span class="badge \${r.processed ? 'status-green' : 'status-yellow'}">\${r.processed ? 'PROCESSED' : 'PENDING'}</span></div>
          <div><strong>Payment Time:</strong> \${new Date(r.session_time).toLocaleString()}</div>
          <div style="margin-top:10px; padding:10px; background:#0f172a; border-radius:8px; font-size:0.75rem; word-break:break-all">
            <strong>Token (rhid):</strong><br>\${r.rhid || 'None'}
          </div>\`;
        
        document.getElementById('modalActions').innerHTML = \`
          <button class="btn \${r.rhid ? 'btn' : 'btn-primary'}" onclick="updateStatus('\${r.mac_address}', '\${r.rhid ? 'PENDING' : 'AUTHENTICATED'}')">
            \${r.rhid ? 'Deauthenticate' : 'Manual Authenticate'}
          </button>
          <button class="btn \${r.processed ? '' : 'btn-primary'}" onclick="updateProcessedStatus(\${r.payment_id}, \${!r.processed})">
            \${r.processed ? 'Mark as Pending' : 'Mark as Processed'}
          </button>\`;
        document.getElementById('detailModal').style.display = 'flex';
      }

      async function updateStatus(mac, status) {
        const res = await fetch(location.href, { method: 'POST', body: JSON.stringify({ action: 'updateStatus', mac, status })});
        if(res.ok) {
           loadPage(currentPage);
           document.getElementById('detailModal').style.display = 'none';
        }
      }

      async function updateProcessedStatus(paymentId, processed) {
        const res = await fetch(location.href, { 
          method: 'POST', 
          body: JSON.stringify({ action: 'updateProcessed', paymentId, processed })
        });
        if(res.ok) {
          loadPage(currentPage);
          document.getElementById('detailModal').style.display = 'none';
        }
      }

      function initChart(data) {
        if (!data) return;
        const ctx = document.getElementById('revenueChart').getContext('2d');
        if(myChart) myChart.destroy();
        myChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.map(d => d.time),
            datasets: [{ 
              label: 'Cumulative Revenue', 
              data: data.map(d => d.total), 
              borderColor: '#3b82f6', 
              borderWidth: 3,
              tension: 0.1, 
              fill: true, 
              pointRadius: 0,
              backgroundColor: 'rgba(59,130,246,0.2)' 
            }]
          },
          options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) { return 'Cumulative: KES ' + context.parsed.y.toLocaleString(); }
                    }
                }
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 12 } },
              y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' }, beginAtZero: true }
            }
          }
        });
      }

      function initMinuteChart(data) {
        if (!data) return;
        const ctx = document.getElementById('minuteChart').getContext('2d');
        if(myMinChart) myMinChart.destroy();
        myMinChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.time),
                datasets: [{
                    label: 'Minutes Sold',
                    data: data.map(d => d.total_mins),
                    backgroundColor: 'rgba(16, 185, 129, 0.5)',
                    borderColor: '#10b981',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 8 } },
                    y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' }, beginAtZero: true }
                }
            }
        });
      }

      function downloadReport() {
        const status = document.getElementById('statusFilter').value;
        const device = document.getElementById('deviceFilter').value;
        const minutes = document.getElementById('minuteFilter').value;
        window.location.href = \`?download=true&status=\${status}&device=\${device}&minutes=\${minutes}\`;
      }

      setInterval(() => { if(activeTab !== 'packages') loadPage(currentPage); }, 30000);
      loadPage(1);
    </script>
  </body>
  </html>`;
}