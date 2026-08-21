cat << 'EOF' > /usr/bin/authentication_list.sh
#!/bin/sh

GATEWAY="bhscyber"
BASE_URL="https://mpesa-wifi-portal.prodigy4614.workers.dev"
POLL_URL="${BASE_URL}/login?auth_get=view&gateway=${GATEWAY}"
CACHE_FILE="/tmp/active_sessions.txt"
BRIDGE_MACS="80:2a:a8:a6:19:da"

RELOAD_THRESHOLD=120
COUNTER=0
CACHE_COUNTER=0
CACHE_REFRESH_CYCLES=30

log_msg() {
    echo "[$(date +'%T')] auth_poller: $1"
}

is_bridge_mac() {
    check_mac=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    for bm in $BRIDGE_MACS; do
        if [ "$(echo "$bm" | tr '[:upper:]' '[:lower:]')" = "$check_mac" ]; then
            return 0
        fi
    done
    return 1
}

log_msg "Birir WiFi Poller: Starting V5.5 (Fixed Subshell State & Shell Syntax)..."

while ! pgrep opennds >/dev/null; do 
    log_msg "[DEBUG] Waiting for opennds service to start..."
    sleep 5
done
sleep 5

fetch_and_cache_sessions() {
    log_msg "[DEBUG] Refreshing local session cache from Worker..."
    uclient-fetch -q -T 5 -O "$CACHE_FILE" "${POLL_URL}&recovery=true" 2>&1
    if [ -f "$CACHE_FILE" ]; then
        log_msg "[DEBUG] Cache file successfully updated. Size: $(wc -c < "$CACHE_FILE") bytes."
    else
        log_msg "[DEBUG] WARNING: Cache file could not be created/updated."
    fi
}

process_recovery_cache() {
    log_msg "[DEBUG] Starting process_recovery_cache()..."
    if [ -f "$CACHE_FILE" ]; then
        NDS_STATUS_OUT=$(ndsctl status 2>/dev/null)

        # Process without subshell redirecting stdin directly
        while read -r line; do
            if [ "$(echo "$line" | cut -c1)" = "*" ]; then
                RHID_KEY=$(echo "$line" | awk '{print $2}' | cut -c1-12)
                MINS=$(echo "$line" | awk '{print $3}')
                UP=$(echo "$line" | awk '{print $4}')
                DOWN=$(echo "$line" | awk '{print $5}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')
                IP=$(echo "$line" | awk '{print $9}' | tr -d '\r\n ')

                if [ -n "$IP" ] && [ "$IP" != "n/a" ]; then
                    if is_bridge_mac "$MAC"; then
                        TARGET_QUERY="$IP"
                        AUTH_TARGET="$IP"
                    else
                        TARGET_QUERY="$MAC"
                        AUTH_TARGET="$MAC"
                    fi

                    if echo "$NDS_STATUS_OUT" | grep -i "$TARGET_QUERY" | grep -qi "Authenticated"; then
                        log_msg "[DEBUG] Client $TARGET_QUERY is already authenticated."
                    else
                        eval "ALREADY_TRIED=\$TRIED_$RHID_KEY"
                        if [ "$ALREADY_TRIED" != "1" ]; then
                            log_msg "CACHED RECONNECT: TARGET=$AUTH_TARGET (MAC=$MAC, IP=$IP). Restoring $MINS mins."
                            log_msg "[DEBUG] Executing: ndsctl auth $AUTH_TARGET $MINS $UP $DOWN 0 0"
                            ndsctl auth "$AUTH_TARGET" "$MINS" "$UP" "$DOWN" 0 0
                            eval "TRIED_$RHID_KEY=1"
                        fi
                    fi
                fi
            fi
        done < "$CACHE_FILE"
    else
        log_msg "[DEBUG] Cache file $CACHE_FILE does not exist."
    fi
}

fetch_and_cache_sessions

while true; do
    COUNTER=$((COUNTER + 1))
    CACHE_COUNTER=$((CACHE_COUNTER + 1))

    log_msg "[DEBUG] --- Main Loop Iteration (Counter: $COUNTER/$RELOAD_THRESHOLD, CacheCounter: $CACHE_COUNTER/$CACHE_REFRESH_CYCLES) ---"

    if [ "$COUNTER" -ge "$RELOAD_THRESHOLD" ]; then
        log_msg "Reload threshold reached. Restarting opennds..."
        /etc/init.d/opennds restart
        sleep 10
        COUNTER=0
    fi

    if [ "$CACHE_COUNTER" -ge "$CACHE_REFRESH_CYCLES" ]; then
        log_msg "[DEBUG] Cache refresh cycle reached."
        fetch_and_cache_sessions
        CACHE_COUNTER=0
    fi

    process_recovery_cache

    RAW_DATA=$(uclient-fetch -q -T 5 -O - "$POLL_URL" 2>/dev/null)
    
    if [ -n "$RAW_DATA" ] && [ "$RAW_DATA" != "*" ]; then
        # Process without piping to avoid subshell
        echo "$RAW_DATA" | while read -r line; do
            if [ "$(echo "$line" | cut -c1)" = "*" ]; then
                RHID=$(echo "$line" | awk '{print $2}')
                MINS=$(echo "$line" | awk '{print $3}')
                UP=$(echo "$line" | awk '{print $4}')
                DOWN=$(echo "$line" | awk '{print $5}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')
                IP=$(echo "$line" | awk '{print $9}' | tr -d '\r\n ')

                if [ -n "$IP" ] && [ "$IP" != "n/a" ]; then
                    if is_bridge_mac "$MAC"; then
                        AUTH_TARGET="$IP"
                    else
                        AUTH_TARGET="$MAC"
                    fi

                    log_msg "NEW AUTH: TARGET=$AUTH_TARGET (MAC=$MAC, IP=$IP). Sending ACK for $RHID"
                    ndsctl auth "$AUTH_TARGET" "$MINS" "$UP" "$DOWN" 0 0
                    uclient-fetch -q -O - "${POLL_URL}&payload=%2a%20${RHID}" > /dev/null 2>&1
                fi
            fi
        done
    fi

    sleep 10
done
EOF
chmod +x /usr/bin/authentication_list.sh