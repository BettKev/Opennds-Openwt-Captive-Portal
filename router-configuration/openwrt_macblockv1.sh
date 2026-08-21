cat << 'EOF' > /usr/bin/macblock
#!/bin/sh

TABLE="inet fw4"
SET_NAME="blocked_macs"

# Ensure the set and drop rule exist in nftables
init_rules() {
    # Create the set if it doesn't already exist
    if ! nft list set $TABLE $SET_NAME >/dev/null 2>&1; then
        nft add set $TABLE $SET_NAME { type ether_addr \; }
        nft insert rule $TABLE forward ether saddr @$SET_NAME drop
    fi
}

init_rules

case "$1" in
    block)
        if [ -z "$2" ]; then
            echo "Error: MAC address required."
            echo "Usage: macblock block <MAC>"
            exit 1
        fi
        nft add element $TABLE $SET_NAME { "$2" }
        echo "Successfully blocked MAC: $2 (IPv4 + IPv6)"
        ;;

    unblock)
        if [ -z "$2" ]; then
            echo "Error: MAC address required."
            echo "Usage: macblock unblock <MAC>"
            exit 1
        fi
        nft delete element $TABLE $SET_NAME { "$2" }
        echo "Successfully unblocked MAC: $2"
        ;;

    list)
        echo "--- Currently Blocked MAC Addresses ---"
        nft list set $TABLE $SET_NAME 2>/dev/null | grep -E '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}'
        ;;

    *)
        echo "Usage: macblock {block|unblock|list} [MAC_ADDRESS]"
        exit 1
        ;;
esac
EOF

chmod +x /usr/bin/macblock