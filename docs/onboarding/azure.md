# Onboarding: Azure Monitor

Connect your Azure subscription to Observo to pull VM, SQL, and other Azure Monitor metrics.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Create an Azure AD app registration](#step-1--create-an-azure-ad-app-registration)
- [Step 2 — Assign the Monitoring Reader role](#step-2--assign-the-monitoring-reader-role)
- [Step 3 — Create a client secret](#step-3--create-a-client-secret)
- [Step 4 — Add the data source in Observo](#step-4--add-the-data-source-in-observo)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

Observo polls Azure Monitor every 60 seconds for metrics from resources in the configured subscription.

---

## Prerequisites

- An Azure subscription
- Permission to create App Registrations in Azure Active Directory
- Permission to assign roles on the subscription (Owner or User Access Administrator)

---

## Step 1 — Create an Azure AD app registration

### Using the Azure Portal

1. Go to **Azure Active Directory → App registrations**
2. Click **New registration**
3. Name it `observo-monitoring`
4. Leave the redirect URI blank
5. Click **Register**
6. Copy the **Application (client) ID** and **Directory (tenant) ID** from the overview page

### Using Azure CLI

```bash
az ad app create --display-name observo-monitoring
```

Then create a service principal:

```bash
az ad sp create --id <app-id>
```

---

## Step 2 — Assign the Monitoring Reader role

```bash
az role assignment create \
  --assignee <client-id> \
  --role "Monitoring Reader" \
  --scope /subscriptions/<subscription-id>
```

Replace `<client-id>` with the Application (client) ID from Step 1.

### Portal

1. Go to **Subscriptions → <your subscription> → Access control (IAM)**
2. Click **Add → Add role assignment**
3. Select **Monitoring Reader**
4. Search for and select `observo-monitoring`

---

## Step 3 — Create a client secret

### Portal

1. In your App Registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Set a description and expiry
4. Copy the **Value** immediately — it is only shown once

### CLI

```bash
az ad app credential reset --id <app-id> --years 2
```

This outputs the `password` field — that is your client secret.

---

## Step 4 — Add the data source in Observo

1. Open Observo → **Settings → Data Sources**
2. Click **Add Source**
3. Select **Azure Monitor**
4. Fill in the fields:

| Field | Value |
|-------|-------|
| **Name** | A display name, e.g. `Production Azure` |
| **Subscription ID** | Your Azure subscription ID |
| **Tenant ID** | Your Azure AD tenant (directory) ID |
| **Client ID** | The Application (client) ID from Step 1 |
| **Client Secret** | The secret value from Step 3 |

5. Click **Add & Test**

---

## Troubleshooting

### `Cannot reach Azure`

The Observo server cannot reach `management.azure.com`. Check outbound firewall rules.

### `401 Unauthorized`

The client secret is wrong or expired. Regenerate it in Step 3 and update the data source.

### `403 Forbidden`

The app registration does not have the Monitoring Reader role. Re-run the role assignment in Step 2.

### Client secret expiry

Azure client secrets expire. Set a calendar reminder before the expiry date to rotate the secret and update the Observo data source.
