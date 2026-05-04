# Opennds-Openwt-Captive-Portal
This is the captive portal system created to work with openwrt based routers.
The entire project use the following:
1. OpenWrt as the linux based Router OS
2. Opennds package as the captive portal
3. Cloudflare workers for the FAS SERVER
4. Cloudflare D1 database as the default SQlite database

In order to run the setup you first need to flash a compatible openwrt version to you router and this will depend entirely on your router version.

The clodflare workers will link to any OpenWrt version as it is written in javascript and will only run on the browser when clients request the page. As these workers are setup as edge functions within cloudflare 99% uptime is guaranteed unless there is a problem with the opennds package failing to call the route.

This project is composed of three directories each with a specific function
1. /admin-portal
    - This is the admin directory. It contains code for the admin dashboard where the user can create/update/delete payment packages, view user session data, manually authenticate/deauthenticate users, view revenue statistics.
    - More feature will be added.
    - Some UI improvement needed also.
2. /mpesa-wifi-portal
    - This is the main captive portal where users can select the package they would like to pay for and enter their phone number to receive an MPESA STK PUSH request on their mobile phone. This captive portal will work both on desktop, laptop and mobile devices.
    - Current payment option works with MPESA only need to add support for Airtel money
    - More feature will be added.
    - Some UI improvement needed also.
3. /router-configuration
    - This directory contains the neccessary custom scripts tat run in the router to support functionality.
    - Here you can add more features that are not available in opennds or use it to make some tweaks incase of opennds compatibilty issues.
    - These script are all in bash
    - These scripts are to be saved in the router memory and made executable

## Setup
The cloudflare workers can be deployed via wrangler CLI from your terminal. Ensure to have a cloudflare account setup and linked
