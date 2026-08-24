cat << 'EOF' > /usr/bin/authentication_list.sh
#!/bin/sh

GATEWAY="bhscyber"
BASE_URL="https://mpesa-wifi-portal.prodigy4614.workers.dev"
POLL_URL="${BASE_URL}/login?auth_get=view&gateway=${GATEWAY}"

POLL_INTERVAL=30             # Poll loop runs every 30 seconds
RELOAD_THRESHOLD=0        # Set to >0 if periodic opennds restarts are needed (240 cycles = 2 hours)

COUNTER=0

log_msg() {
    logger -t auth_poller "$1"
}

log_msg "Birir WiFi Poller: Starting V8.1 Production (MAC-Only Auth Polling)..."

while ! pgrep opennds >/dev/null; do 
    log_msg "[DEBUG] Waiting for opennds service to start..."
    sleep 5
done
sleep 2

while true; do
    COUNTER=$((COUNTER + 1))

    log_msg "[LOOP] Starting cycle $COUNTER..."

    if [ "$RELOAD_THRESHOLD" -gt 0 ] && [ "$COUNTER" -ge "$RELOAD_THRESHOLD" ]; then
        log_msg "[RELOAD] Reload threshold reached. Restarting opennds service..."
        /etc/init.d/opennds restart
        sleep 5
        COUNTER=0
    fi

    RAW_DATA=$(uclient-fetch -q -T 5 -O - "$POLL_URL" 2>/dev/null)
    
    if [ -n "$RAW_DATA" ] && [ "$RAW_DATA" != "*" ]; then
        echo "$RAW_DATA" | while read -r line; do
            case "$line" in
                \**)
                    RHID=$(echo "$line" | awk '{print $2}')
                    MINS=$(echo "$line" | awk '{print $3}')
                    UP=$(echo "$line" | awk '{print $4}')
                    DOWN=$(echo "$line" | awk '{print $5}')
                    MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')

                    if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                        log_msg "[NEW AUTH] Valid payment found! MAC=$MAC, RHID=$RHID ($MINS mins)."
                        
                        AUTH_OUT=$(ndsctl auth "$MAC" "$MINS" "$UP" "$DOWN" 0 0 2>&1)
                        log_msg "[DEBUG] ndsctl auth response: $AUTH_OUT"

                        ACK_URL="${POLL_URL}&payload=%2a%20${RHID}"
                        ACK_RES=$(uclient-fetch -q -O - "$ACK_URL" 2>&1)
                        log_msg "[DEBUG] Worker ACK response: $ACK_RES"
                        
                        sleep 1
                    fi
                    ;;
            esac
        done
    else
        log_msg "[DEBUG] Poll complete: No pending real-time payments."
    fi

    log_msg "[LOOP] Sleeping for $POLL_INTERVAL seconds..."
    sleep $POLL_INTERVAL
done
EOF
chmod +x /usr/bin/authentication_list.sh
/etc/init.d/auth_poller restart