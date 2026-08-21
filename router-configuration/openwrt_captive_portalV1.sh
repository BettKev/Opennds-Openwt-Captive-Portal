cat << 'EOF' > /www/cgi-bin/portal.cgi
#!/bin/sh

CODES_FILE="/tmp/portal_codes.txt"
touch "$CODES_FILE"

echo "Content-Type: text/html"
echo ""

CLIENT_IP="$REMOTE_ADDR"

# Resolve Client IP to MAC address
CLIENT_MAC=$(awk -v ip="$CLIENT_IP" '$1 == ip {print $4}' /proc/net/arp 2>/dev/null | tr 'a-z' 'A-Z' | head -n1)
if [ -z "$CLIENT_MAC" ] || [ "$CLIENT_MAC" = "00:00:00:00:00:00" ]; then
    CLIENT_MAC=$(ip neigh show "$CLIENT_IP" 2>/dev/null | awk '{print $5}' | tr 'a-z' 'A-Z' | head -n1)
fi

INPUT_CODE=""
if [ "$REQUEST_METHOD" = "POST" ] && [ -n "$CONTENT_LENGTH" ]; then
    READ_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    INPUT_CODE=$(echo "$READ_DATA" | sed -n 's/.*code=\([^&]*\).*/\1/p' | sed 's/+/ /g; s/%/\\x/g' | xargs -0 printf "%b" 2>/dev/null)
fi

MESSAGE=""
STATUS_CLASS=""
UNBLOCKED=0

if [ -n "$INPUT_CODE" ]; then
    # Check if the code exists in the active codes file
    if grep -qx "$INPUT_CODE" "$CODES_FILE" 2>/dev/null; then
        if [ -n "$CLIENT_MAC" ] && [ "$CLIENT_MAC" != "00:00:00:00:00:00" ]; then
            # 1. Unblock MAC via script
            /usr/bin/macblock unblock "$CLIENT_MAC" >/dev/null 2>&1
            
            # 2. Consume/Delete single-use code from /tmp
            sed -i "/^$INPUT_CODE$/d" "$CODES_FILE"
            
            MESSAGE="Access Granted! Internet enabled for $CLIENT_MAC."
            STATUS_CLASS="success"
            UNBLOCKED=1
        else
            MESSAGE="Error: Unable to resolve your device's MAC address."
            STATUS_CLASS="error"
        fi
    else
        MESSAGE="Invalid or expired access code."
        STATUS_CLASS="error"
    fi
fi

cat <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Internet Access Portal</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
        .portal-card { background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; width: 100%; max-width: 380px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; }
        h2 { margin: 0 0 0.5rem 0; font-size: 1.5rem; color: #f8fafc; }
        p.subtitle { margin: 0 0 1.5rem 0; font-size: 0.9rem; color: #94a3b8; }
        .message { padding: 0.75rem; border-radius: 6px; margin-bottom: 1.25rem; font-size: 0.875rem; font-weight: 600; }
        .success { background-color: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #4ade80; }
        .error { background-color: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #f87171; }
        input[type="text"] { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #475569; border-radius: 6px; background-color: #0f172a; color: #fff; font-size: 1.2rem; text-align: center; letter-spacing: 0.2em; font-family: monospace; }
        button, a.btn { display: inline-block; width: 100%; padding: 0.75rem; background-color: #0284c7; border: none; border-radius: 6px; color: #fff; font-size: 1rem; font-weight: 600; text-decoration: none; cursor: pointer; }
        .details { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #334155; font-size: 0.75rem; color: #64748b; text-align: left; }
        .details span { color: #94a3b8; font-family: monospace; }
    </style>
</head>
<body>
    <div class="portal-card">
        <h2>Network Access</h2>
        <p class="subtitle">Enter your access code to connect.</p>

        $([ -n "$MESSAGE" ] && echo "<div class=\"message $STATUS_CLASS\">$MESSAGE</div>")

        $([ "$UNBLOCKED" -eq 1 ] && echo '<a href="http://neverssl.com" class="btn">Continue to Internet</a>' || echo '
        <form method="POST" action="/cgi-bin/portal.cgi">
            <input type="text" name="code" placeholder="000000" maxlength="6" required autofocus />
            <button type="submit">Unlock Access</button>
        </form>
        ')

        <div class="details">
            <div>IP Address: <span>$CLIENT_IP</span></div>
            <div>MAC Address: <span>${CLIENT_MAC:-Unknown}</span></div>
        </div>
    </div>
</body>
</html>
HTML
EOF

chmod +x /www/cgi-bin/portal.cgi