#!/bin/sh /etc/rc.common

# File location /etc/init.d/auth_poller

# This tells OpenWrt to start after the network and OpenNDS are ready
START=99
USE_PROCD=1

start_service() {
    procd_open_instance
    # This runs your existing script using the shell
    procd_set_param command /bin/sh /usr/bin/authentication_list.sh
    
    # RESPAWN: This is the auto-restart magic.
    # It will restart the script if it crashes or the process dies.
    procd_set_param respawn ${respawn_threshold:-3600} ${respawn_timeout:-5} ${respawn_retry:-0}
    
    # Send all script output (echoes/errors) to the system log (logread)
    procd_set_param stdout 1
    procd_set_param stderr 1
    
    procd_close_instance
}