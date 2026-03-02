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
          await env.DB.prepare(`INSERT INTO packages (name, amount, duration_hours, upload_rate, download_rate) VALUES (?, ?, ?, ?, ?)`)
            .bind(body.name, body.amount, body.duration, body.upload, body.download)
            .run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }

        if (body.action === 'editPackage') {
          await env.DB.prepare(`UPDATE packages SET name = ?, amount = ?, duration_hours = ?, upload_rate = ?, download_rate = ? WHERE id = ?`)
            .bind(body.name, body.amount, body.duration, body.upload, body.download, body.id)
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
      SUM(CASE WHEN created_at >= date('now', '-1 day') AND created_at < date('now') THEN amount ELSE 0 END) as prev_daily,
      SUM(CASE WHEN created_at >= date('now', '-7 days') THEN amount ELSE 0 END) as weekly,
      SUM(CASE WHEN created_at >= date('now', '-14 days') AND created_at < date('now', '-7 days') THEN amount ELSE 0 END) as prev_weekly,
      SUM(CASE WHEN created_at >= date('now', '-30 days') THEN amount ELSE 0 END) as monthly,
      SUM(CASE WHEN created_at >= date('now', '-60 days') AND created_at < date('now', '-30 days') THEN amount ELSE 0 END) as prev_monthly
    FROM payments WHERE UPPER(status) = 'PAID'
  `).first();

  // --- CHART LOGIC: MULTI-SCALE TRENDS ---
  // Revised Daily Query for SQLite consistency
  const dailyData = await env.DB.prepare(`
    WITH RECURSIVE hours(h) AS (
      SELECT 0 UNION ALL SELECT h + 1 FROM hours WHERE h < 23
    ),
    TimeSlots AS (
      SELECT printf('%02d:00', h) as time FROM hours
    ),
    CurrentDay AS (
      SELECT strftime('%H:00', created_at) as time, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now') GROUP BY time
    ),
    PrevDay AS (
      SELECT strftime('%H:00', created_at) as time, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now', '-1 day') AND created_at < date('now') GROUP BY time
    )
    SELECT ts.time, 
           COALESCE(cd.subtotal, 0) as current_sub,
           COALESCE(pd.subtotal, 0) as prev_sub
    FROM TimeSlots ts
    LEFT JOIN CurrentDay cd ON ts.time = cd.time
    LEFT JOIN PrevDay pd ON ts.time = pd.time
    ORDER BY ts.time ASC
  `).all();

  const weeklyData = await env.DB.prepare(`
    WITH RECURSIVE days(n) AS (
      SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 6
    ),
    CurrentWeekSlots AS (
      SELECT date('now', '-' || n || ' days') as day FROM days
    ),
    PrevWeekSlots AS (
      SELECT date('now', '-' || (n + 7) || ' days') as day FROM days
    ),
    Stats AS (
      SELECT date(created_at) as day, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now', '-14 days') GROUP BY day
    )
    SELECT cw.day, 
           COALESCE(s_curr.subtotal, 0) as current_sub,
           COALESCE(s_prev.subtotal, 0) as prev_sub
    FROM CurrentWeekSlots cw
    LEFT JOIN Stats s_curr ON cw.day = s_curr.day
    LEFT JOIN PrevWeekSlots pw ON date(cw.day, '-7 days') = pw.day
    LEFT JOIN Stats s_prev ON pw.day = s_prev.day
    ORDER BY cw.day ASC
  `).all();

  const monthlyData = await env.DB.prepare(`
    WITH RECURSIVE days(n) AS (
      SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 29
    ),
    CurrentMonthSlots AS (
      SELECT date('now', '-' || n || ' days') as day FROM days
    ),
    PrevMonthSlots AS (
      SELECT date('now', '-' || (n + 30) || ' days') as day FROM days
    ),
    Stats AS (
      SELECT date(created_at) as day, SUM(amount) as subtotal
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now', '-60 days') GROUP BY day
    )
    SELECT cm.day, 
           COALESCE(s_curr.subtotal, 0) as current_sub,
           COALESCE(s_prev.subtotal, 0) as prev_sub
    FROM CurrentMonthSlots cm
    LEFT JOIN Stats s_curr ON cm.day = s_curr.day
    LEFT JOIN PrevMonthSlots pm ON date(cm.day, '-30 days') = pm.day
    LEFT JOIN Stats s_prev ON pm.day = s_prev.day
    ORDER BY cm.day ASC
  `).all();

  // Process data for cumulative totals
  const processCumulative = (results) => {
    let currTotal = 0, prevTotal = 0;
    return results.map(r => {
      currTotal += r.current_sub;
      prevTotal += r.prev_sub;
      return { time: r.time || r.day, total: currTotal, prev_total: prevTotal };
    });
  };

  const finalDaily = processCumulative(dailyData.results);
  const finalWeekly = processCumulative(weeklyData.results);
  const finalMonthly = processCumulative(monthlyData.results);

  // --- MINUTE USAGE CHART LOGIC ---
  const minuteTrend = await env.DB.prepare(`
    WITH RECURSIVE hours(h) AS (
      SELECT 0 UNION ALL SELECT h + 1 FROM hours WHERE h < 23
    ),
    TimeSlots AS (
      SELECT printf('%02d:00', h) as time FROM hours
    ),
    Usage AS (
      SELECT strftime('%H:00', created_at) as time, SUM(duration_minutes) as total_mins
      FROM payments WHERE UPPER(status) = 'PAID' AND created_at >= date('now') GROUP BY time
    )
    SELECT ts.time, COALESCE(u.total_mins, 0) as total_mins
    FROM TimeSlots ts
    LEFT JOIN Usage u ON ts.time = u.time
    ORDER BY ts.time ASC
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
    earnings: { 
      daily: earnings?.daily || 0, 
      prev_daily: earnings?.prev_daily || 0,
      weekly: earnings?.weekly || 0, 
      prev_weekly: earnings?.prev_weekly || 0,
      monthly: earnings?.monthly || 0,
      prev_monthly: earnings?.prev_monthly || 0
    },
    chartData: {
      daily: finalDaily,
      weekly: finalWeekly,
      monthly: finalMonthly,
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
      <td>
        <div style="font-size:0.7rem; color:#94a3b8">↑ ${p.upload_rate || 0} kbps</div>
        <div style="font-size:0.7rem; color:#94a3b8">↓ ${p.download_rate || 0} kbps</div>
      </td>
      <td style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <small style="color:#94a3b8">${p.created_at}</small>
        <div style="display:flex; gap:4px;">
          <button class="btn" style="background:var(--primary); border:none; padding:4px 8px; color:white; cursor:pointer;" onclick='openEditPackageModal(${JSON.stringify(p)})'>Edit</button>
          <button class="btn" style="background:#ef4444; border:none; padding:4px 8px; color:white; cursor:pointer;" onclick="deletePackage(${p.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');

  const formatTrend = (curr, prev) => {
    if (!prev) return `<span style="color:#22c55e">New</span>`;
    const diff = ((curr - prev) / prev) * 100;
    const color = diff >= 0 ? '#22c55e' : '#ef4444';
    const arrow = diff >= 0 ? '↑' : '↓';
    return `<span style="color:${color}; font-size:0.75rem; font-weight:bold">${arrow} ${Math.abs(diff).toFixed(1)}%</span>`;
  };
  
  const dailyTrend = formatTrend(data.earnings.daily, data.earnings.prev_daily);
  const weeklyTrend = formatTrend(data.earnings.weekly, data.earnings.prev_weekly);
  const monthlyTrend = formatTrend(data.earnings.monthly, data.earnings.prev_monthly);

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
          :root { --primary: #3b82f6; --bg: #0f172a; --surface: #1e293b; --text: #f8fafc; --border: #334155; --secondary: #10b981; }
          body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; margin: 0; }
          nav { background: #020617; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
          .container { max-width: 1200px; margin: 1.5rem auto; padding: 0 20px; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
          .stat-card { background: var(--surface); padding: 1.5rem; border-radius: 16px; border: 1px solid var(--border); position: relative; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); transition: 0.3s; }
          .stat-card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
          .stat-value { font-size: 1.5rem; font-weight: 800; margin: 0.5rem 0; color: var(--text); }
          .stat-label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
          .stat-trend { display: flex; align-items: center; gap: 4px; }
          .filter-bar { display: flex; gap: 12px; margin-bottom: 1.5rem; flex-wrap: wrap; }
          .search-input { flex-grow: 1; padding: 0.6rem 1rem; border-radius: 10px; border: 1px solid var(--border); background: #0f172a; color: white; transition: 0.3s; }
          .search-input:focus { border-color: var(--primary); outline: none; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--surface); border-radius: 16px; overflow: hidden; border: 1px solid var(--border); }
          th { background: #263449; text-align: left; padding: 14px; font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
          td { padding: 14px; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
          tr:last-child td { border-bottom: none; }
          .badge { padding: 4px 10px; border-radius: 20px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; }
          .status-green { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }
          .status-yellow { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); }
          .pulse { width: 8px; height: 8px; background: #34d399; border-radius: 50%; display: inline-block; margin-right: 8px; animation: pulse 2s infinite; }
          @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
          .btn { padding: 0.6rem 1.2rem; border-radius: 10px; border: 1px solid var(--border); background: #334155; color: white; cursor: pointer; font-weight: 600; font-size: 0.85rem; transition: 0.2s; display: flex; align-items: center; gap: 8px; }
          .btn:hover { background: #475569; }
          .btn-primary { background: var(--primary); border: none; }
          .btn-primary:hover { background: #2563eb; }
          #installBtn { display: none; margin-right: 15px; background: #10b981; border: none; font-weight: 700; }
          .tabs { display: flex; gap: 8px; margin-bottom: 1.5rem; background: #020617; padding: 4px; border-radius: 12px; border: 1px solid var(--border); width: fit-content; }
          .tab-btn { background: none; border: none; color: #94a3b8; padding: 8px 16px; cursor: pointer; font-weight: 600; transition: 0.2s; border-radius: 8px; font-size: 0.85rem; }
          .tab-btn:hover { color: white; }
          .tab-btn.active { color: white; background: var(--surface); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .modal-overlay { position: fixed; inset: 0; background: rgba(2,6,23,0.85); display: none; justify-content: center; align-items: center; z-index: 1000; backdrop-filter: blur(8px); }
          .modal { background: var(--surface); padding: 2rem; border-radius: 24px; width: 440px; border: 1px solid var(--border); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
          .audio-toggle { font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; gap: 8px; cursor: pointer; margin-right: 15px; font-weight: 600;}
          .form-group { margin-bottom: 1.25rem; }
          .form-group label { display: block; margin-bottom: 6px; font-size: 0.8rem; color: #94a3b8; font-weight: 600; }
          .form-group input { width: 100%; padding: 10px 12px; border-radius: 8px; background: #0f172a; border: 1px solid var(--border); color: white; box-sizing: border-box; transition: 0.3s; }
          .form-group input:focus { border-color: var(--primary); outline: none; }
          .chart-toggle-group { display: flex; gap: 6px; padding: 4px; background: #0f172a; border-radius: 8px; border: 1px solid var(--border); }
          .chart-toggle-btn { padding: 4px 12px; font-size: 0.7rem; border-radius: 6px; border: none; background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600; transition: 0.2s; }
          .chart-toggle-btn:hover { color: white; }
          .chart-toggle-btn.active { background: var(--primary); color: white; }
          .charts-wrapper { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; }
          .chart-card { background: var(--surface); padding: 1.5rem; border-radius: 20px; border: 1px solid var(--border); height: 380px; position: relative; }
          .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
          .chart-title { font-size: 0.75rem; color: #94a3b8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
        </style>
      </head>
      <body>
        <nav>
          <div style="font-weight:900; letter-spacing:1.5px; font-size:1.2rem;">BHS <span style="color:var(--primary)">ADMIN</span> <span style="font-size:0.6rem; vertical-align:middle; background:var(--primary); padding:2px 6px; border-radius:4px; margin-left:4px;">PRO</span></div>
          <div style="display:flex; align-items:center;">
            <button id="installBtn" class="btn btn-primary">📲 Install App</button>
            <label class="audio-toggle">
              <input type="checkbox" id="audioEnable" onchange="requestNotifyPermission()"> Alerts
            </label>
            <span class="pulse"></span>
            <span id="nav-active" class="badge status-green">${data.activeCount} ONLINE</span>
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
              <div class="stat-card">
                <div class="stat-label">DAILY REVENUE</div>
                <div class="stat-value" id="stat-daily">KES ${data.earnings.daily.toLocaleString()}</div>
                <div class="stat-trend">${dailyTrend} <span class="stat-label" style="font-size:0.6rem; margin-left:4px">vs yesterday</span></div>
              </div>
              <div class="stat-card">
                <div class="stat-label">WEEKLY REVENUE</div>
                <div class="stat-value" id="stat-weekly">KES ${data.earnings.weekly.toLocaleString()}</div>
                <div class="stat-trend">${weeklyTrend} <span class="stat-label" style="font-size:0.6rem; margin-left:4px">vs prev week</span></div>
              </div>
              <div class="stat-card">
                <div class="stat-label">MONTHLY REVENUE</div>
                <div class="stat-value" id="stat-monthly">KES ${data.earnings.monthly.toLocaleString()}</div>
                <div class="stat-trend">${monthlyTrend} <span class="stat-label" style="font-size:0.6rem; margin-left:4px">vs prev month</span></div>
              </div>
            </div>
            <div class="charts-wrapper">
                <div class="chart-card">
                  <div class="chart-header">
                    <div class="chart-title">Revenue Trends</div>
                    <div class="chart-toggle-group">
                      <button class="chart-toggle-btn active" onclick="setChartRange('daily')">Daily</button>
                      <button class="chart-toggle-btn" onclick="setChartRange('weekly')">Weekly</button>
                      <button class="chart-toggle-btn" onclick="setChartRange('monthly')">Monthly</button>
                    </div>
                  </div>
                  <div style="height:280px"><canvas id="revenueChart"></canvas></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <div class="chart-title">Minute Usage (24H)</div>
                    </div>
                    <div style="height:280px"><canvas id="minuteChart"></canvas></div>
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
          <thead><tr><th>Name</th><th>Price</th><th>Duration</th><th>Limits</th><th>Action</th></tr></thead>
          <tbody id="packageTable">${packageRows}</tbody>
        </table>
      </div>
    </div>

    <div id="packageModal" class="modal-overlay" onclick="closePackageModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <h3 id="pkgModalTitle" style="color:var(--primary); margin-top:0">Add New Package</h3>
        <input type="hidden" id="pkgId">
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
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group">
            <label>Upload (kbps)</label>
            <input type="number" id="pkgUpload" placeholder="e.g. 1024">
          </div>
          <div class="form-group">
            <label>Download (kbps)</label>
            <input type="number" id="pkgDownload" placeholder="e.g. 2048">
          </div>
        </div>
        <button id="pkgSubmitBtn" class="btn btn-primary" style="width:100%; margin-top:10px;" onclick="savePackage()">Save Package</button>
        <button class="btn" style="width:100%; margin-top:10px;" onclick="closePackageModal()">Cancel</button>
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

      function openAddPackageModal() { 
        document.getElementById('pkgId').value = '';
        document.getElementById('pkgName').value = '';
        document.getElementById('pkgAmount').value = '';
        document.getElementById('pkgDuration').value = '';
        document.getElementById('pkgUpload').value = '';
        document.getElementById('pkgDownload').value = '';
        document.getElementById('pkgModalTitle').innerText = 'Add New Package';
        document.getElementById('pkgSubmitBtn').innerText = 'Save Package';
        document.getElementById('packageModal').style.display = 'flex'; 
      }

      function openEditPackageModal(p) {
        document.getElementById('pkgId').value = p.id;
        document.getElementById('pkgName').value = p.name;
        document.getElementById('pkgAmount').value = p.amount;
        document.getElementById('pkgDuration').value = p.duration_hours;
        document.getElementById('pkgUpload').value = p.upload_rate || '';
        document.getElementById('pkgDownload').value = p.download_rate || '';
        document.getElementById('pkgModalTitle').innerText = 'Edit Package';
        document.getElementById('pkgSubmitBtn').innerText = 'Update Package';
        document.getElementById('packageModal').style.display = 'flex';
      }

      function closePackageModal() { document.getElementById('packageModal').style.display = 'none'; }

      async function savePackage() {
        const id = document.getElementById('pkgId').value;
        const name = document.getElementById('pkgName').value;
        const amount = document.getElementById('pkgAmount').value;
        const duration = document.getElementById('pkgDuration').value;
        const upload = document.getElementById('pkgUpload').value || 0;
        const download = document.getElementById('pkgDownload').value || 0;
        
        if(!name || !amount || !duration) return alert("Please fill name, amount and duration");
        
        const action = id ? 'editPackage' : 'addPackage';
        const res = await fetch(location.href, {
          method: 'POST',
          body: JSON.stringify({ action, id, name, amount, duration, upload, download })
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
        
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

        const prevGradient = ctx.createLinearGradient(0, 0, 0, 300);
        prevGradient.addColorStop(0, 'rgba(148, 163, 184, 0.1)');
        prevGradient.addColorStop(1, 'rgba(148, 163, 184, 0)');

        myChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.map(d => d.time),
            datasets: [
              { 
                label: 'Current Period', 
                data: data.map(d => d.total), 
                borderColor: '#3b82f6', 
                borderWidth: 3,
                tension: 0.4, 
                fill: true, 
                backgroundColor: gradient,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#0f172a',
                pointBorderWidth: 2,
                pointHoverRadius: 6
              },
              { 
                label: 'Previous Period', 
                data: data.map(d => d.prev_total), 
                borderColor: '#64748b', 
                borderWidth: 2,
                borderDash: [5, 5],
                tension: 0.4, 
                fill: true, 
                backgroundColor: prevGradient,
                pointRadius: 0,
                pointHoverRadius: 4
              }
            ]
          },
          options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { 
                  display: true, 
                  position: 'bottom',
                  labels: { color: '#94a3b8', boxWidth: 12, usePointStyle: true, padding: 20 }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: '#334155',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function(context) { return context.dataset.label + ': KES ' + context.parsed.y.toLocaleString(); }
                    }
                }
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 12, font: { size: 10 } } },
              y: { 
                grid: { color: 'rgba(51, 65, 85, 0.5)', borderDash: [2, 2] }, 
                ticks: { color: '#64748b', font: { size: 10 }, callback: value => 'KES ' + value.toLocaleString() },
                beginAtZero: true 
              }
            }
          }
        });
      }

      function initMinuteChart(data) {
        if (!data) return;
        const ctx = document.getElementById('minuteChart').getContext('2d');
        if(myMinChart) myMinChart.destroy();

        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.8)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.2)');

        myMinChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.time),
                datasets: [{
                    label: 'Minutes Sold',
                    data: data.map(d => d.total_mins),
                    backgroundColor: gradient,
                    borderRadius: 6,
                    hoverBackgroundColor: '#10b981'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: '#1e293b',
                    padding: 12,
                    callbacks: { label: context => context.parsed.y.toLocaleString() + ' mins' }
                  }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } } },
                    y: { 
                      grid: { color: 'rgba(51, 65, 85, 0.5)', borderDash: [2, 2] }, 
                      ticks: { color: '#64748b', font: { size: 10 } }, 
                      beginAtZero: true 
                    }
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