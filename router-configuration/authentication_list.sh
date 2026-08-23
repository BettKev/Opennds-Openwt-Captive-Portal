cat << 'EOF' > /usr/bin/authentication_list.sh
#!/bin/sh

GATEWAY="bhscyber"
BASE_URL="https://mpesa-wifi-portal.prodigy4614.workers.dev"
POLL_URL="${BASE_URL}/login?auth_get=view&gateway=${GATEWAY}"
CACHE_FILE="/tmp/active_sessions.txt"
NDS_STATE_FILE="/tmp/nds_states.txt"

# Space-separated list of MAC addresses belonging to range extenders / bridge devices
BRIDGE_MACS="68:f0:bc:10:20:a8 80:2a:a8:a6:19:da"

POLL_INTERVAL=30             # Poll loop runs every 15 seconds
CACHE_REFRESH_CYCLES=20      # Refresh remote cache every 10 mins (60 * 30s)
RELOAD_THRESHOLD=240           # Set to >0 if periodic opennds restarts are needed/restart every 2 hours

COUNTER=0
CACHE_COUNTER=0

log_msg() {
    logger -t auth_poller "$1"
}

# Helper function: Returns 0 (true) if the MAC is in the BRIDGE_MACS list
is_bridge_mac() {
    local target_mac="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
    for bridge_mac in $BRIDGE_MACS; do
        bridge_mac="$(echo "$bridge_mac" | tr '[:upper:]' '[:lower:]')"
        if [ "$target_mac" = "$bridge_mac" ]; then
            return 0
        fi
    done
    return 1
}

# Helper function: Verify physical presence in ARP table via MAC or IP column
is_online_in_arp() {
    local mac="$1"
    local ip="$2"
    
    if [ -n "$mac" ] && grep -qi "$mac" /proc/net/arp; then
        return 0
    fi
    if [ -n "$ip" ] && awk '{print $1}' /proc/net/arp | grep -q "^${ip}$"; then
        return 0
    fi
    return 1
}

log_msg "Birir WiFi Poller: Starting V7.3 Production (MAC/IP Conditional Authentication)..."

while ! pgrep opennds >/dev/null; do 
    log_msg "[DEBUG] Waiting for opennds service to start..."
    sleep 5
done
sleep 2

# Robust openNDS JSON parser
dump_nds_states_to_file() {
    RETRY=0
    while [ $RETRY -lt 3 ]; do
        NDS_JSON=$(ndsctl json 2>/dev/null)
        SIZE=$(echo "$NDS_JSON" | wc -c)
        if [ "$SIZE" -gt 100 ]; then
            echo "$NDS_JSON" | awk '
                BEGIN { RS="}"; FS="," }
                {
                    mac=""; ip=""; state=""
                    for (i=1; i<=NF; i++) {
                        if ($i ~ /"mac":|"id":/) {
                            match($i, /"([0-9a-fa-f]{2}:){5}[0-9a-fa-f]{2}"/)
                            if (RLENGTH > 0) mac = tolower(substr($i, RSTART+1, RLENGTH-2))
                        }
                        if ($i ~ /"ip":/) {
                            match($i, /"([0-9]{1,3}\.){3}[0-9]{1,3}"/)
                            if (RLENGTH > 0) ip = substr($i, RSTART+1, RLENGTH-2)
                        }
                        if ($i ~ /"state":/) {
                            match($i, /"state"[ ]*:[ ]*"[^"]+"/)
                            if (RLENGTH > 0) {
                                split(substr($i, RSTART, RLENGTH), a, "\"")
                                state = a[4]
                            }
                        }
                    }
                    if (state != "") {
                        # Clean duplicate state tokens
                        split(state, s_words, " ")
                        state = s_words[1]
                        
                        if (mac != "") print "MAC:" mac " " state
                        if (ip != "") print "IP:" ip " " state
                    }
                }
            ' | sort -u > "$NDS_STATE_FILE"
            return 0
        fi
        RETRY=$((RETRY + 1))
        sleep 1
    done
    rm -f "$NDS_STATE_FILE"
    return 1
}

fetch_and_cache_sessions() {
    log_msg "[DEBUG] Refreshing local session cache from Worker URL: ${POLL_URL}&recovery=true"
    uclient-fetch -q -T 5 -O "$CACHE_FILE" "${POLL_URL}&recovery=true" 2>&1
    
    if [ -f "$CACHE_FILE" ]; then
        SIZE=$(wc -c < "$CACHE_FILE")
        log_msg "[DEBUG] Cache refresh completed. Size: $SIZE bytes."
    else
        log_msg "[ERROR] Failed to update $CACHE_FILE."
    fi
}

process_recovery_cache() {
    if [ ! -f "$CACHE_FILE" ]; then 
        log_msg "[DEBUG] Recovery pass skipped: $CACHE_FILE does not exist."
        return 
    fi

    if ! dump_nds_states_to_file; then
        log_msg "[WARN] Could not fetch openNDS socket state. Skipping recovery pass."
        return
    fi

    log_msg "[DEBUG] Beginning session recovery evaluation pass..."

    while read -r line; do
        case "$line" in
            \**)
                MINS=$(echo "$line" | awk '{print $3}')
                UP=$(echo "$line" | awk '{print $4}')
                DOWN=$(echo "$line" | awk '{print $5}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')
                IP=$(echo "$line" | awk '{print $9}' | tr -d '\r\n ')

                TARGET=""
                LOOKUP_KEY=""

                if is_bridge_mac "$MAC"; then
                    if [ -n "$IP" ] && [ "$IP" != "n/a" ]; then
                        TARGET="$IP"
                        LOOKUP_KEY="IP:$IP"
                        log_msg "[ROUTING] MAC $MAC is a Bridge. Using IP authentication target: $IP"
                    fi
                else
                    if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                        TARGET="$MAC"
                        LOOKUP_KEY="MAC:$MAC"
                    fi
                fi

                if [ -n "$TARGET" ]; then
                    
                    if ! is_online_in_arp "$MAC" "$IP"; then
                        log_msg "[DEBUG] Recovery Skip: TARGET=$TARGET (MAC=$MAC) - Not found in router ARP table (Offline)."
                        continue
                    fi

                    # Primary lookup: IP/MAC state key
                    STATE=$(grep -i "^$LOOKUP_KEY " "$NDS_STATE_FILE" | awk '{print $2}')
                    
                    # Fallback lookup: Primary MAC state key if IP key misses
                    if [ -z "$STATE" ] && [ -n "$MAC" ]; then
                        STATE=$(grep -i "^MAC:$MAC " "$NDS_STATE_FILE" | awk '{print $2}')
                    fi

                    [ -z "$STATE" ] && STATE="Unknown"

                    case "$STATE" in
                        "Preauthenticated"|"preauthenticated")
                            log_msg "[RECOVERY MATCH] TARGET=$TARGET in state '$STATE'. Executing ndsctl auth ($MINS mins, UP:$UP, DOWN:$DOWN)."
                            AUTH_RES=$(ndsctl auth "$TARGET" "$MINS" "$UP" "$DOWN" 0 0 2>&1)
                            log_msg "[DEBUG] ndsctl auth output: $AUTH_RES"
                            sleep 1
                            ;;
                        *)
                            log_msg "[DEBUG] Recovery Skip: TARGET=$TARGET - Current state is '$STATE' (No action required)."
                            ;;
                    esac
                fi
                ;;
        esac
    done < "$CACHE_FILE"
}

# Initial fetch and recovery on script launch
fetch_and_cache_sessions
process_recovery_cache

while true; do
    COUNTER=$((COUNTER + 1))
    CACHE_COUNTER=$((CACHE_COUNTER + 1))

    log_msg "[LOOP] Starting cycle $COUNTER (Cache Cycle $CACHE_COUNTER/$CACHE_REFRESH_CYCLES)..."

    if [ "$RELOAD_THRESHOLD" -gt 0 ] && [ "$COUNTER" -ge "$RELOAD_THRESHOLD" ]; then
        log_msg "[RELOAD] Reload threshold reached. Restarting opennds service..."
        /etc/init.d/opennds restart
        sleep 5
        COUNTER=0
    fi

    if [ "$CACHE_COUNTER" -ge "$CACHE_REFRESH_CYCLES" ]; then
        fetch_and_cache_sessions
        CACHE_COUNTER=0
    fi

    process_recovery_cache

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
                    IP=$(echo "$line" | awk '{print $9}' | tr -d '\r\n ')

                    TARGET=""
                    if is_bridge_mac "$MAC"; then
                        if [ -n "$IP" ] && [ "$IP" != "n/a" ]; then
                            TARGET="$IP"
                            log_msg "[ROUTING] Real-time Auth: Bridge MAC $MAC detected. Target set to IP=$IP"
                        fi
                    else
                        if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                            TARGET="$MAC"
                        fi
                    fi

                    if [ -n "$TARGET" ]; then
                        log_msg "[NEW AUTH] Valid payment found! TARGET=$TARGET (MAC=$MAC, IP=$IP), RHID=$RHID ($MINS mins)."
                        
                        AUTH_OUT=$(ndsctl auth "$TARGET" "$MINS" "$UP" "$DOWN" 0 0 2>&1)
                        log_msg "[DEBUG] ndsctl auth response: $AUTH_OUT"

                        ACK_URL="${POLL_URL}&payload=%2a%20${RHID}"
                        ACK_RES=$(uclient-fetch -q -O - "$ACK_URL" 2>&1)
                        log_msg "[DEBUG] Worker ACK response: $ACK_RES"
                        
                        fetch_and_cache_sessions
                        CACHE_COUNTER=0
                        
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