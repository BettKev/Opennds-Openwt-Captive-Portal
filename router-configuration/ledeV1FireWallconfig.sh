# Run this block directly in your terminal to overwrite /etc/firewall.user

cat << 'EOF' > /etc/firewall.user
# =========================================================
# --- Portal Lifecycle Reset Hook ---
# =========================================================
# Flush custom portal chains
iptables -t nat -F prerouting_lan_rule 2>/dev/null
iptables -F forwarding_lan_rule 2>/dev/null
ip6tables -F forwarding_lan_rule 2>/dev/null

# 1. Redirect all LAN DNS queries (UDP/TCP 53) to local router (prevents DNS bypass)
iptables -t nat -A prerouting_lan_rule -p udp --dport 53 -j REDIRECT --to-ports 53
iptables -t nat -A prerouting_lan_rule -p tcp --dport 53 -j REDIRECT --to-ports 53

# 2. Default Catch-All: Block IPv6 forwarding
ip6tables -A forwarding_lan_rule -j DROP

# 3. Instant REJECT for UDP 443 (QUIC/HTTP3) to stop buffering timeouts on unauthenticated clients
iptables -A forwarding_lan_rule -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable

# =========================================================
# --- Persistent Whitelisted Hardware Addresses (IPv4 & IPv6) ---
# =========================================================
# Device 1
iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source "a8:4f:a4:37:d1:74" -j ACCEPT
iptables -I forwarding_lan_rule 1 -m mac --mac-source "a8:4f:a4:37:d1:74" -j ACCEPT
ip6tables -I forwarding_lan_rule 1 -m mac --mac-source "a8:4f:a4:37:d1:74" -j ACCEPT

# Device 2
iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source "e2:9e:ff:02:3e:c4" -j ACCEPT
iptables -I forwarding_lan_rule 1 -m mac --mac-source "e2:9e:ff:02:3e:c4" -j ACCEPT
ip6tables -I forwarding_lan_rule 1 -m mac --mac-source "e2:9e:ff:02:3e:c4" -j ACCEPT

# Device 3
iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source "26:5d:e6:6c:6a:76" -j ACCEPT
iptables -I forwarding_lan_rule 1 -m mac --mac-source "26:5d:e6:6c:6a:76" -j ACCEPT
ip6tables -I forwarding_lan_rule 1 -m mac --mac-source "26:5d:e6:6c:6a:76" -j ACCEPT

# =========================================================
# --- Default Catch-All: Block All Unauthenticated Traffic ---
# =========================================================
# Anything that didn't match a whitelisted MAC above gets rejected instantly
iptables -A forwarding_lan_rule -j REJECT --reject-with icmp-port-unreachable

# =========================================================
# --- Flush Connection Tracking ---
# =========================================================
if command -v conntrack >/dev/null 2>&1; then
    conntrack -F 2>/dev/null
elif [ -e /proc/sys/net/netfilter/nf_conntrack_max ]; then
    echo 1 > /proc/sys/net/netfilter/nf_conntrack_max
    echo 10000 > /proc/sys/net/netfilter/nf_conntrack_max
fi
EOF


# If you have not already configured dnsmasq to sinkhole TikTok domains to 0.0.0.0, run this once to finish the setup:

cat << 'EOF' > /etc/dnsmasq.d/tiktok_block.conf
address=/tiktok.com/0.0.0.0
address=/tiktokcdn.com/0.0.0.0
address=/tiktokv.com/0.0.0.0
address=/byteoversea.com/0.0.0.0
address=/ibyteimg.com/0.0.0.0
address=/musically.com/0.0.0.0
address=/musical.ly/0.0.0.0
address=/v16-webapp-prime.tiktok.com/0.0.0.0
EOF

/etc/init.d/dnsmasq restart



# Here is the updated CGI script with input sanitization, memory limits, validated MAC matching, and reduced polling overhead:

cat << 'EOF' > /www/cgi-bin/index
#!/bin/sh

# 1. Sanitize & Limit POST execution length (Max 128 bytes)
if [ "$REQUEST_METHOD" = "POST" ]; then
    [ -z "$CONTENT_LENGTH" ] && CONTENT_LENGTH=0
    if [ "$CONTENT_LENGTH" -gt 128 ]; then
        CONTENT_LENGTH=128
    fi
    read -n "$CONTENT_LENGTH" POST_DATA
fi

# 2. Extract and sanitize client IP & MAC
GUEST_IP="$REMOTE_ADDR"
GUEST_MAC=$(grep -w "$GUEST_IP" /proc/net/arp | awk '{print $4}' | grep -E '^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$')

# 3. Resolve router LAN IP for redirect checks
DYNAMIC_LAN_IP=$(ubus call network.interface.lan status 2>/dev/null | grep -A2 '"ipv4-address"' | grep '"address"' | awk -F'"' '{print $4}')
[ -z "$DYNAMIC_LAN_IP" ] && DYNAMIC_LAN_IP="192.168.1.1"

# Strip port numbers from HTTP_HOST for clean comparison
REQUEST_HOST=$(echo "$HTTP_HOST" | awk -F: '{print $1}')

STATUS_MSG=""

# 4. Handle POST Authentication
if [ "$REQUEST_METHOD" = "POST" ]; then
    # Strictly extract alphanumeric code and capitalize
    INPUT_CODE=$(echo "$POST_DATA" | sed -n 's/.*guest_code=\([^&]*\).*/\1/p' | sed 's/[^a-zA-Z0-9]//g' | tr 'a-z' 'A-Z')
    ACTIVE_CODE=$(cat /var/run/portal_code 2>/dev/null | tr -d '\r\n')

    if [ -n "$INPUT_CODE" ] && [ -n "$ACTIVE_CODE" ] && [ "$INPUT_CODE" = "$ACTIVE_CODE" ]; then
        if [ -n "$GUEST_MAC" ]; then
            iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source "$GUEST_MAC" -j ACCEPT
            iptables -I forwarding_lan_rule 1 -m mac --mac-source "$GUEST_MAC" -j ACCEPT
            ip6tables -I forwarding_lan_rule 1 -m mac --mac-source "$GUEST_MAC" -j ACCEPT
            
            # Flush connection tracking for guest IP to apply firewall changes instantly
            if command -v conntrack >/dev/null 2>&1; then
                conntrack -D -s "$GUEST_IP" 2>/dev/null
            fi

            rm -f /var/run/portal_code
            STATUS_MSG="SUCCESS"
        else
            STATUS_MSG="ERROR: Could not resolve device hardware address."
        fi
    else
        STATUS_MSG="ERROR: Invalid or expired code."
    fi
fi

# 5. Handle Status Check Endpoint
if [ "$QUERY_STRING" = "check_status" ]; then
    echo "Content-Type: text/plain"
    echo ""
    if [ -n "$GUEST_MAC" ] && iptables -t nat -C prerouting_lan_rule -m mac --mac-source "$GUEST_MAC" -j ACCEPT 2>/dev/null; then
        echo "ALLOWED"
    else
        echo "BLOCKED"
    fi
    exit 0
fi

# 6. Redirect External Requests to Portal IP
if [ "$REQUEST_HOST" != "$DYNAMIC_LAN_IP" ] || [ "$SCRIPT_NAME" != "/cgi-bin/index" ]; then
    echo "Status: 307 Temporary Redirect"
    echo "Location: http://$DYNAMIC_LAN_IP/cgi-bin/index"
    echo "Content-Type: text/html"
    echo ""
    exit 0
fi

# 7. Deliver Interface Page
echo "Content-Type: text/html; charset=utf-8"
echo ""
echo "<!DOCTYPE html>
<html>
<head>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>HILTON HOTEL Wi-Fi</title>
    <style>
        body { font-family: monospace, sans-serif; background: #000000; color: #ffffff; text-align: center; padding: 30px 15px; margin: 0; }
        .box { background: #000000; border: 3px solid #ffffff; padding: 25px; max-width: 400px; margin: 0 auto; }
        h1 { letter-spacing: 2px; text-transform: uppercase; margin-bottom: 5px; }
        .sub-head { font-size: 11px; color: #aaaaaa; margin-top: 0; margin-bottom: 25px; text-transform: uppercase; }
        .input-text { width: 85%; padding: 12px; font-size: 18px; border: 2px solid #ffffff; background: #000000; color: #ffffff; text-align: center; text-transform: uppercase; font-family: monospace; margin-bottom: 15px; }
        .btn { width: 92%; background: #ffffff; color: #000000; font-weight: bold; font-size: 16px; border: 2px solid #ffffff; padding: 12px; text-transform: uppercase; cursor: pointer; font-family: monospace; }
        .btn:hover { background: #000000; color: #ffffff; }
        .msg { margin: 15px 0; font-weight: bold; font-size: 14px; text-transform: uppercase; background: #ffffff; color: #000000; padding: 8px; display: inline-block; }
        .ads-box { margin-top: 35px; border-top: 2px dashed #ffffff; padding-top: 20px; text-align: left; }
        .ads-title { font-size: 14px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #ffffff; padding-bottom: 4px; margin-bottom: 10px; text-align: center; }
        .ad-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }
        .ad-item { border: 1px solid #333333; padding: 6px; text-transform: uppercase; text-align: center; }
        .footer { font-size: 10px; color: #888888; margin-top: 40px; text-transform: uppercase; letter-spacing: 1px; }
    </style>
    <script>
        setInterval(function(){
            fetch('/cgi-bin/index?check_status').then(r => r.text()).then(st => {
                if(st.trim() === 'ALLOWED') {
                    document.getElementById('main-form').innerHTML = '<h2>ACCESS GRANTED</h2><p>You are now connected to the Internet.</p>';
                }
            });
        }, 8000);
    </script>
</head>
<body>
    <div class='box'>
        <h1>HILTON HOTEL</h1>
        <div class='sub-head'>Captive Internet Gateway</div>
        
        <div id='main-form'>"
        if [ -n "$STATUS_MSG" ]; then
            echo "<div class='msg'>$STATUS_MSG</div>"
        fi
        echo "
        <form method='POST'>
            <p>Enter the authentication code provided at the desk:</p>
            <input type='text' name='guest_code' class='input-text' placeholder='4-CHAR CODE' maxlength='4' required autocomplete='off'>
            <button type='submit' class='btn'>Connect Device</button>
        </form>
        </div>

        <div class='ads-box'>
            <div class='ads-title'>BHS CYBER Cafe Services</div>
            <div class='ad-grid'>
                <div class='ad-item'>Photocopy</div>
                <div class='ad-item'>Printing</div>
                <div class='ad-item'>KRA Returns</div>
                <div class='ad-item'>eCitizen</div>
                <div class='ad-item'>WiFi Setup</div>
                <div class='ad-item'>Software Dev</div>
            </div>
        </div>

        <div class='footer'>System Managed by BHS CYBER</div>
    </div>
</body>
</html>"
EOF

chmod +x /www/cgi-bin/index



# Replace /www/cgi-bin/portal with this patched version. It fixes the authentication bypass, adds strict MAC regex validation, flushes active conntrack sessions on revocation, and pairs cleanly with your updated /etc/firewall.user.


cat << 'EOF' > /www/cgi-bin/portal
#!/bin/sh

# =========================================================
# 1. Read POST Data & Parse Cookies
# =========================================================
if [ "$REQUEST_METHOD" = "POST" ] && [ "$CONTENT_LENGTH" -gt 0 ]; then
    read -n "$CONTENT_LENGTH" POST_DATA
fi

COOKIE_TOKEN=$(echo "$HTTP_COOKIE" | sed -n 's/.*session_id=\([^;]*\).*/\1/p')
TOKEN_FILE="/var/run/admin_session"
CURRENT_TOKEN=$(cat $TOKEN_FILE 2>/dev/null)

ADMIN_PASS=$(cat /etc/portal_secret 2>/dev/null)
[ -z "$ADMIN_PASS" ] && ADMIN_PASS="admin123"

JUST_LOGGED_IN="false"
IS_AUTHENTICATED="false"

# Verify pre-existing session before handling actions
if [ -n "$CURRENT_TOKEN" ] && [ "$COOKIE_TOKEN" = "$CURRENT_TOKEN" ]; then
    IS_AUTHENTICATED="true"
fi

# =========================================================
# 2. Process Actions (Authenticated Only)
# =========================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    ACTION=$(echo "$POST_DATA" | sed -n 's/.*action=\([^&]*\).*/\1/p')
    
    case "$ACTION" in
        login)
            PASS_INPUT=$(echo "$POST_DATA" | sed -n 's/.*password=\([^&]*\).*/\1/p' | sed 's/%23/#/g')
            if [ "$PASS_INPUT" = "$ADMIN_PASS" ]; then
                CURRENT_TOKEN=$(dd if=/dev/urandom bs=1 count=16 2>/dev/null | hexdump -e '"%02x"')
                echo "$CURRENT_TOKEN" > $TOKEN_FILE
                echo "Set-Cookie: session_id=$CURRENT_TOKEN; Path=/; HttpOnly"
                JUST_LOGGED_IN="true"
                IS_AUTHENTICATED="true"
            fi
            ;;
        logout)
            rm -f $TOKEN_FILE
            CURRENT_TOKEN="LOGGED_OUT"
            IS_AUTHENTICATED="false"
            echo "Set-Cookie: session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
            ;;
        generate_code)
            if [ "$IS_AUTHENTICATED" = "true" ]; then
                NEW_CODE=$(dd if=/dev/urandom bs=512 count=1 2>/dev/null | tr -cd 'A-Z0-9' | head -c 4)
                echo "$NEW_CODE" > /var/run/portal_code
                echo "Content-Type: text/plain"
                echo ""
                echo "$NEW_CODE"
                exit 0
            fi
            ;;
        whitelist_mac)
            if [ "$IS_AUTHENTICATED" = "true" ]; then
                RAW_MAC=$(echo "$POST_DATA" | sed -n 's/.*mac_addr=\([^&]*\).*/\1/p' | sed 's/%3A/:/g' | tr 'A-Z' 'a-z')
                
                # Strict MAC Regex Validation (Must be exactly 6 hex pairs separated by colons)
                if echo "$RAW_MAC" | grep -qE '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'; then
                    iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source "$RAW_MAC" -j ACCEPT 2>/dev/null
                    iptables -I forwarding_lan_rule 1 -m mac --mac-source "$RAW_MAC" -j ACCEPT 2>/dev/null
                    ip6tables -I forwarding_lan_rule 1 -m mac --mac-source "$RAW_MAC" -j ACCEPT 2>/dev/null
                    
                    if [ -f /etc/firewall.user ] && ! grep -qi "$RAW_MAC" /etc/firewall.user; then
                        echo "iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source \"$RAW_MAC\" -j ACCEPT" >> /etc/firewall.user
                        echo "iptables -I forwarding_lan_rule 1 -m mac --mac-source \"$RAW_MAC\" -j ACCEPT" >> /etc/firewall.user
                        echo "ip6tables -I forwarding_lan_rule 1 -m mac --mac-source \"$RAW_MAC\" -j ACCEPT" >> /etc/firewall.user
                    fi
                fi
            fi
            ;;
        remove_whitelist)
            if [ "$IS_AUTHENTICATED" = "true" ]; then
                TARGET_MAC=$(echo "$POST_DATA" | sed -n 's/.*target_mac=\([^&]*\).*/\1/p' | sed 's/%3A/:/g' | tr 'A-Z' 'a-z')
                if echo "$TARGET_MAC" | grep -qE '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'; then
                    iptables -t nat -D prerouting_lan_rule -m mac --mac-source "$TARGET_MAC" -j ACCEPT 2>/dev/null
                    iptables -D forwarding_lan_rule -m mac --mac-source "$TARGET_MAC" -j ACCEPT 2>/dev/null
                    ip6tables -D forwarding_lan_rule -m mac --mac-source "$TARGET_MAC" -j ACCEPT 2>/dev/null
                    
                    if [ -f /etc/firewall.user ]; then
                        sed -i "/$TARGET_MAC/d" /etc/firewall.user
                    fi
                    
                    # Flush connection tracking to immediately sever active sockets
                    echo 1 > /proc/sys/net/netfilter/nf_conntrack_flush 2>/dev/null
                fi
            fi
            ;;
        authorize_top)
            if [ "$IS_AUTHENTICATED" = "true" ]; then
                TARGET_MAC=$(echo "$POST_DATA" | sed -n 's/.*target_mac=\([^&]*\).*/\1/p' | sed 's/%3A/:/g' | tr 'A-Z' 'a-z')
                if echo "$TARGET_MAC" | grep -qE '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'; then
                    if ! iptables -t nat -C prerouting_lan_rule -m mac --mac-source "$TARGET_MAC" -j ACCEPT 2>/dev/null; then
                        iptables -t nat -I prerouting_lan_rule 1 -m mac --mac-source "$TARGET_MAC" -j ACCEPT
                        iptables -I forwarding_lan_rule 1 -m mac --mac-source "$TARGET_MAC" -j ACCEPT
                        ip6tables -I forwarding_lan_rule 1 -m mac --mac-source "$TARGET_MAC" -j ACCEPT
                    fi
                fi
            fi
            ;;
    esac
fi

# =========================================================
# 3. Render HTML Admin Dashboard
# =========================================================
echo "Content-Type: text/html; charset=utf-8"
echo ""

GENERATED_CODE=$(cat /var/run/portal_code 2>/dev/null)
[ -z "$GENERATED_CODE" ] && GENERATED_CODE="NONE"

TMP_LIST=$(iwinfo wlan0 assoclist 2>/dev/null | grep "ms ago" | while read -r line; do
    M=$(echo "$line" | awk '{print $1}')
    T=$(echo "$line" | awk '{print $(NF-2)}')
    echo "$T $M"
done | sort -n)

AUTH_COUNT=0
while read -r time_val mac_val; do
    [ -z "$mac_val" ] && continue
    if iptables -t nat -C prerouting_lan_rule -m mac --mac-source "$mac_val" -j ACCEPT 2>/dev/null; then
        AUTH_COUNT=$((AUTH_COUNT + 1))
    fi
done << EOL
$TMP_LIST
EOL

cat << HTML
<!DOCTYPE html>
<html>
<head>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>HILTON HOTEL - Gatekeeper Admin</title>
    <style>
        body { font-family: monospace, sans-serif; background: #000000; color: #ffffff; padding: 20px 0; margin: 0; text-align: center; }
        .box { max-width: 420px; margin: 0 auto; border: 3px solid #ffffff; padding: 25px 15px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        h2, h3 { text-transform: uppercase; letter-spacing: 1px; margin-top: 0; width: 100%; text-align: center; }
        form { width: 100%; display: flex; flex-direction: column; align-items: center; }
        .input-field { width: 90%; padding: 12px; background: #000000; border: 2px solid #ffffff; color: #ffffff; font-family: monospace; margin-bottom: 15px; font-size: 15px; text-align: center; box-sizing: border-box; text-transform: uppercase; }
        .btn { width: 90%; background: #ffffff; color: #000000; border: 2px solid #ffffff; padding: 12px; font-weight: bold; text-transform: uppercase; cursor: pointer; font-family: monospace; margin-bottom: 10px; font-size: 14px; box-sizing: border-box; transition: background 0.2s; }
        .btn:hover { background: #000000; color: #ffffff; }
        .btn-revoke { background: #000000; color: #ff3b30; border-color: #ff3b30; margin: 0; font-size: 11px; padding: 8px; }
        .btn-revoke:hover { background: #ff3b30; color: #ffffff; border-color: #ff3b30; }
        .btn-logout { background: #000000; color: #ffffff; border-color: #ffffff; width: auto; padding: 6px 12px; font-size: 11px; margin-bottom: 20px; align-self: center; }
        .section-wrapper { width: 100%; margin-bottom: 25px; border-bottom: 1px solid #ffffff; padding-bottom: 20px; display: flex; flex-direction: column; align-items: center; }
        .card { width: 90%; border: 1px solid #ffffff; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; text-align: center; }
        .card form { margin-top: 10px; }
        .code-display { font-size: 32px; font-weight: bold; border: 2px dashed #ffffff; padding: 10px; margin: 15px 0; text-align: center; letter-spacing: 4px; background: #ffffff; color: #000000; width: 80%; box-sizing: border-box; }
        .footer { font-size: 10px; color: #888888; text-align: center; margin-top: 30px; text-transform: uppercase; border-top: 1px solid #333; padding-top: 15px; width: 100%; }
        
        .auth-true .login-view { display: none !important; }
        .auth-true .dashboard-view { display: flex !important; flex-direction: column !important; align-items: center !important; }
        
        .auth-false .login-view { display: block !important; }
        .auth-false .dashboard-view { display: none !important; }
    </style>
    <script>
        function triggerGenCode() {
            fetch('/cgi-bin/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=generate_code'
            })
            .then(res => res.text())
            .then(code => {
                if(code.trim()) {
                    document.getElementById('codeBox').innerText = code.trim();
                }
            });
        }
    </script>
</head>
<body class='auth-$IS_AUTHENTICATED'>
    <div class='box'>
        <h2>HILTON HOTEL</h2>
        
        <div class='login-view' style='width: 100%;'>
            <h3>Owner Authentication Required</h3>
            <form method='POST'>
                <input type='hidden' name='action' value='login'>
                <p>Enter Master Firewall Password:</p>
                <input type='password' name='password' class='input-field' placeholder='PASSWORD' required>
                <button type='submit' class='btn'>Authenticate Owner</button>
            </form>
        </div>

        <div class='dashboard-view' style='width: 100%;'>
            <form method='POST' style='width: auto;'>
                <input type='hidden' name='action' value='logout'>
                <button type='submit' class='btn btn-logout'>Exit Admin</button>
            </form>
            <h3>Owner Control Board</h3>
            
            <div class='section-wrapper'>
                <p style='text-align:center;'>Generate Volatile Token for One Client Device:</p>
                <div class='code-display' id='codeBox'>$GENERATED_CODE</div>
                <button type='button' class='btn' onclick='triggerGenCode()'>Generate 4-Char Token</button>
            </div>

            <div class='section-wrapper'>
                <p style='text-align:center;'>Add Permanent Whitelist Device (Survives Reboots):</p>
                <form method='POST'>
                    <input type='hidden' name='action' value='whitelist_mac'>
                    <input type='text' name='mac_addr' class='input-field' placeholder='00:AA:BB:CC:DD:EE' required>
                    <button type='submit' class='btn'>Add & Permanent Open</button>
                </form>
            </div>

            <div class='section-wrapper' style='border-bottom:none; margin-bottom:10px;'>
                <h3>Permanently Whitelisted Devices</h3>
HTML

if [ -f /etc/firewall.user ]; then
    grep -oE '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' /etc/firewall.user | tr 'A-Z' 'a-z' | sort -u | while read -r p_mac; do
        [ -z "$p_mac" ] && continue
        upper_pmac=$(echo "$p_mac" | tr 'a-z' 'A-Z')
        echo "<div class='card' style='border-color:#ff3b30;'>"
        echo "<div><strong>MAC: $upper_pmac</strong><br><small style='color:#aaaaaa;'>Persistent Whitelist</small></div>"
        echo "<form method='POST'><input type='hidden' name='action' value='remove_whitelist'><input type='hidden' name='target_mac' value='$p_mac'><button type='submit' class='btn btn-revoke'>Revoke & Lock</button></form>"
        echo "</div>"
    done
fi

cat << HTML
            </div>

            <h3>Active Queue Devices (Authorized: $AUTH_COUNT)</h3>
HTML

while read -r time_val mac_val; do
    [ -z "$mac_val" ] && continue
    if ! iptables -t nat -C prerouting_lan_rule -m mac --mac-source "$mac_val" -j ACCEPT 2>/dev/null; then
        upper_mac=$(echo "$mac_val" | tr 'a-z' 'A-Z')
        echo "<div class='card'>"
        echo "<div><strong>MAC: $upper_mac</strong><br><small style='color:#888888;'>Volatile Device Queue</small></div>"
        echo "</div>"
    fi
done << EOL
$TMP_LIST
EOL

cat << HTML
        </div>

        <div class='footer'>System Managed by BHS CYBER</div>
    </div>
</body>
</html>
HTML
EOF
chmod +x /www/cgi-bin/portal

