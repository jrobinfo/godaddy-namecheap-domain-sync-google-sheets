# Domain Management & Sync with Google Sheets

## Overview

This project provides a solution for managing and synchronizing domain information from GoDaddy and Namecheap into a centralized Google Sheet. It consists of Google Apps Scripts for interacting with the domain registrars and a Node.js proxy application for Namecheap API calls. The proxy component is designed to be deployed, for instance, on Hetzner Coolify, and is referred to as "Domains Proxy".

## Architecture

The system is composed of the following key parts:

1.  **Google Apps Script**:
    *   Handles direct communication with the GoDaddy API.
    *   Communicates with the Namecheap API via the dedicated Node.js proxy.
    *   Processes the retrieved domain data (details, contacts, DNS records).
    *   Populates and updates specific sheets within a Google Spreadsheet.
    *   Uses caching to minimize API calls and stay within rate limits.

2.  **Node.js Proxy (Domains Proxy)**:
    *   An Express.js application that acts as an intermediary for Namecheap API requests.
    *   This is necessary to manage Namecheap's IP-based API access restrictions, allowing the Google Apps Script (which runs on varying Google IPs) to reliably connect.
    *   Supports optional Basic Authentication for security.
    *   Deployed as a standalone application (e.g., on Hetzner Coolify).

3.  **Google Sheets**:
    *   The central repository for the consolidated domain information.
    *   Contains separate sheets for GoDaddy and Namecheap domains, as well as sheets for logging missing data.
    *   The Google Sheet serves as the private, central database for domain data synchronized by the scripts.

## Features

*   **GoDaddy Domain Sync**: Retrieves domain list, details (creation/expiration dates, status, auto-renewal), contact information, and DNS records.
*   **Namecheap Domain Sync**: Retrieves domain list, details (creation/expiration dates, status, auto-renewal, WhoisGuard), contact information, and DNS records via the proxy.
*   **DNS Record Fetching**: Collects various DNS record types (NS, A, AAAA, CNAME, MX, TXT) for each domain.
*   **DoH Fallback**: Uses DNS over HTTPS (DoH) via Google's resolver as a fallback if API-provided DNS information is incomplete.
*   **Caching**: Implements caching within Google Apps Script to reduce redundant API calls and improve performance.
*   **Missing Data Logging**: Tracks and logs domains or specific data points that couldn't be fetched successfully.
*   **Configurable**: API keys, proxy settings, and other parameters are managed via Script Properties in Google Apps Script and environment variables for the proxy.

## Components

### 1. Google Apps Script

*   **Link to edit the Apps Script**: The Apps Script project can be accessed via your Google Apps Script dashboard (script.google.com).

*   **`Config.gs`**:
    *   Stores shared constants for both GoDaddy and Namecheap scripts.
    *   `LIMITS`: Defines the maximum number of each DNS record type to display in the sheet.
    *   `CORE_COL_NC`, `CORE_COL_GD`: Specifies the core column headers for Namecheap and GoDaddy sheets.
    *   `CACHE_TTL`: Cache duration for API responses (in seconds).
    *   `CALL_PAUSE`: Pause duration (in milliseconds) between Namecheap API calls to respect rate limits.
    *   `API_BASE_GD`, `LIST_PATH_GD`, `DETAIL_PATH_GD`: GoDaddy API endpoint constants.
    *   `BATCH_SLEEP_GD`: Pause duration (in milliseconds) between GoDaddy API calls.

*   **`godaddy.gs`**:
    *   `syncGoDaddySheet()`: Main function to fetch and sync GoDaddy domain data.
    *   Interacts directly with the GoDaddy API.
    *   Manages data for the "GoDaddyDomains" and "Missing-Data" sheets.

*   **`namecheap.gs`**:
    *   `syncNamecheapSheet()`: Main function to fetch and sync Namecheap domain data.
    *   Interacts with the Namecheap API through the deployed Node.js proxy.
    *   Manages data for the "NamecheapDomains" and "Missing-Data (NC)" sheets.

### 2. Node.js Proxy (Domains Proxy)

This proxy is deployed on your Hetzner Coolify application under the name "Domains Proxy".

*   **`index.js`**:
    *   The main Express.js application file.
    *   Sets up a single endpoint (`/nc`) that forwards requests to the Namecheap API (`https://api.namecheap.com/xml.response`).
    *   Handles GET request query strings and request bodies for other methods.
    *   Implements optional Basic Authentication.
    *   Uses `helmet` for basic security headers.

*   **`package.json`**:
    *   Defines project metadata and dependencies:
        *   `express`: Web framework.
        *   `node-fetch`: For making HTTP requests.
        *   `helmet`: For security headers.
        *   `basic-auth`: For Basic Authentication parsing.
    *   Includes a `start` script: `node index.js`.

*   **`Dockerfile`**:
    *   Defines the Docker image for deploying the proxy.
    *   Uses `node:20-slim` as the base image.
    *   Installs dependencies using `npm ci --omit=dev`.
    *   Exposes port `3000`.
    *   Runs `npm start` as the default command.

## Setup and Configuration

### 1. Google Apps Script

1.  **Open the Project**:
    *   Use the provided link to access the Apps Script project: [Apps Script Editor](https://script.google.com/u/0/home/projects/17mmZIAf8P31Wo9zc2mcZjq7qcQXD2H24bk14vNJPZCLtOzL7p9TzhYWj)
2.  **Set Script Properties**:
    *   In the Apps Script editor, go to "Project Settings" (the gear icon ⚙️).
    *   Scroll down to "Script Properties" and click "Add script property".
    *   Add the following properties:
        *   **For GoDaddy (`godaddy.gs`)**:
            *   `GODADDY_KEY`: Your GoDaddy API Key.
            *   `GODADDY_SECRET`: Your GoDaddy API Secret.
        *   **For Namecheap (`namecheap.gs`)**:
            *   `NC_API_USER`: Your Namecheap API Username.
            *   `NC_API_KEY`: Your Namecheap API Key.
            *   `NC_CLIENT_IP`: The public IP address of your "Domains Proxy" application (the one deployed on Hetzner Coolify). This IP must be whitelisted in your Namecheap API settings.
            *   `PROXY_URL`: The full URL to your "Domains Proxy" `/nc` endpoint (e.g., `https://your-proxy-domain.coolify-app.com/nc`).
            *   `PROXY_USER` (Optional): Username for Basic Auth on the proxy, if configured.
            *   `PROXY_PASS` (Optional): Password for Basic Auth on the proxy, if configured.
3.  **Authorize Scripts**:
    *   The first time you run a function (e.g., `syncGoDaddySheet` or `syncNamecheapSheet`) from the editor, Google will prompt you to authorize the script's permissions (accessing external services, Google Sheets, etc.). Follow the prompts to grant necessary permissions.
4.  **Run Sync Functions**:
    *   Select `syncGoDaddySheet` or `syncNamecheapSheet` from the function dropdown in the Apps Script editor and click "Run".
5.  **Set Up Triggers (Optional)**:
    *   To automate the sync process, you can set up time-driven triggers.
    *   In the Apps Script editor, go to "Triggers" (the clock icon ⏰).
    *   Click "Add Trigger".
    *   Choose the function to run (e.g., `syncNamecheapSheet`).
    *   Select "Time-driven" as the event source.
    *   Configure the frequency (e.g., daily).

### 2. Node.js Proxy (Domains Proxy on Hetzner Coolify)

1.  **Deployment**:
    *   Deploy the Node.js application (contents of `index.js`, `package.json`, `Dockerfile`) to your Hetzner Coolify instance under the name "Domains Proxy".
    *   Ensure the application is accessible via a public URL.
2.  **Environment Variables**:
    *   Configure the following environment variables in your Coolify application settings:
        *   `PORT`: The port the application should listen on (e.g., `3000`). Coolify typically handles port mapping.
        *   `PROXY_USER` (Optional): If you want to enable Basic Authentication for the proxy, set this to your desired username.
        *   `PROXY_PASS` (Optional): If `PROXY_USER` is set, set this to your desired password.
3.  **Namecheap API IP Whitelisting**:
    *   Obtain the public IP address of your deployed "Domains Proxy" on Coolify.
    *   Log in to your Namecheap account and navigate to your API settings.
    *   Whitelist this public IP address to allow API requests from your proxy. This IP should be the value for the `NC_CLIENT_IP` script property.

## Usage

1.  **Manual Sync**:
    *   Open the Google Apps Script project.
    *   Select either `syncGoDaddySheet` or `syncNamecheapSheet` from the function execution dropdown.
    *   Click the "Run" button.
    *   Check the Google Sheet for updated domain information in the respective "GoDaddyDomains" or "NamecheapDomains" tabs.
    *   Review the "Missing-Data" or "Missing-Data (NC)" sheets for any issues.
2.  **Automated Sync**:
    *   If time-driven triggers are configured, the scripts will run automatically at the specified intervals.

## Logs and Debugging

*   **Google Apps Script Logs**: Check the "Executions" section in the Apps Script editor to view logs for each script run. `Logger.log()` statements in the `.gs` files will output here.
*   **Proxy Application Logs**: Check the logs for your "Domains Proxy" application within your Hetzner Coolify dashboard. `console.error()` and `console.log()` in `index.js` will output here.
*   **Google Sheet "Missing-Data" tabs**: These sheets will contain entries for domains where data fetching encountered issues.

## Important Notes

*   **API Rate Limits**: Both GoDaddy and Namecheap have API rate limits. The scripts include pauses (`CALL_PAUSE`, `BATCH_SLEEP_GD`) to help manage this, but be mindful of how frequently you run the syncs, especially with a large number of domains.
*   **Security**:
    *   Protect your API keys (`GODADDY_KEY`, `GODADDY_SECRET`, `NC_API_KEY`) and proxy credentials (`PROXY_USER`, `PROXY_PASS`). Store them securely in Script Properties and environment variables, respectively.
    *   Do not commit sensitive credentials directly into the codebase.
*   **Proxy IP Address**: If the public IP address of your "Domains Proxy" on Coolify changes, you **must** update the `NC_CLIENT_IP` script property in Google Apps Script and re-whitelist the new IP in your Namecheap API settings.
*   **Error Handling**: The scripts include basic error handling and logging. Monitor the logs and "Missing-Data" sheets to identify and resolve any issues. 