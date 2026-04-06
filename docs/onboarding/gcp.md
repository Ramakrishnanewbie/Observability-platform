# Onboarding: GCP Cloud Monitoring

Connect your Google Cloud project to Observo to pull Compute Engine and Cloud SQL metrics.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Create a service account](#step-1--create-a-service-account)
- [Step 2 — Grant the Monitoring Viewer role](#step-2--grant-the-monitoring-viewer-role)
- [Step 3 — Download the service account key](#step-3--download-the-service-account-key)
- [Step 4 — Add the data source in Observo](#step-4--add-the-data-source-in-observo)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

Observo polls GCP Cloud Monitoring every 60 seconds for:

| Metric | Observo name |
|--------|-------------|
| Compute Engine CPU utilisation | `gcp.compute.cpu_utilization` |
| Compute Engine memory used | `gcp.compute.memory_used` |
| Compute Engine disk read bytes | `gcp.compute.disk_read_bytes` |
| Compute Engine disk write bytes | `gcp.compute.disk_write_bytes` |
| Compute Engine network received bytes | `gcp.compute.network_recv_bytes` |
| Cloud SQL CPU utilisation | `gcp.cloudsql.cpu_utilization` |

---

## Prerequisites

- A GCP project with the **Cloud Monitoring API** enabled
- `roles/iam.serviceAccountAdmin` or Owner permission to create a service account

Enable the API if needed:

```bash
gcloud services enable monitoring.googleapis.com --project=YOUR_PROJECT_ID
```

---

## Step 1 — Create a service account

### Using the GCP Console

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**
3. Name it something like `observo-monitoring`
4. Click **Create and Continue**

### Using gcloud CLI

```bash
gcloud iam service-accounts create observo-monitoring \
  --display-name="Observo Monitoring" \
  --project=YOUR_PROJECT_ID
```

---

## Step 2 — Grant the Monitoring Viewer role

This read-only role is the minimum required.

### Console

In the service account creation wizard, click **Grant this service account access to project**, then add:

- Role: **Monitoring Viewer** (`roles/monitoring.viewer`)

### gcloud CLI

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:observo-monitoring@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/monitoring.viewer"
```

---

## Step 3 — Download the service account key

### Console

1. Open the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key → Create new key**
4. Select **JSON** and click **Create**
5. The key file downloads automatically — keep it safe

### gcloud CLI

```bash
gcloud iam service-accounts keys create observo-key.json \
  --iam-account=observo-monitoring@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

The downloaded JSON looks like this (shortened):

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n",
  "client_email": "observo-monitoring@your-project-id.iam.gserviceaccount.com",
  "client_id": "123456789",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

---

## Step 4 — Add the data source in Observo

1. Open Observo → **Settings → Data Sources**
2. Click **Add Source**
3. Select **GCP Cloud Monitoring**
4. Fill in the fields:

| Field | Value |
|-------|-------|
| **Name** | A display name, e.g. `Production GCP` |
| **Project ID** | Your GCP project ID (e.g. `my-project-123`) |
| **Service Account JSON** | Paste the entire contents of the downloaded JSON key file |

5. Click **Add & Test**

A green **Connected** badge appears within a few seconds when the connection succeeds. If it shows **Error**, see [Troubleshooting](#troubleshooting).

---

## Troubleshooting

### `GCP auth failed: failed to decode PEM private key`

The private key in the JSON is malformed. Make sure you pasted the entire file contents — do not trim or reformat the key.

### `GCP Monitoring returned 403`

The service account does not have the Monitoring Viewer role. Re-run the IAM binding command in Step 2.

### `GCP Monitoring returned 404`

The **Project ID** is wrong, or the Cloud Monitoring API is not enabled for that project. Run:

```bash
gcloud services enable monitoring.googleapis.com --project=YOUR_PROJECT_ID
```

### `GCP token endpoint returned 400: invalid_grant`

The server clock is too far out of sync (JWTs have a short validity window). Sync your server time:

```bash
sudo timedatectl set-ntp true    # Linux systemd
```

### Metrics appear but instances are missing

Observo uses the `instance_id` label from the GCP resource. Make sure your Compute Engine instances have Cloud Monitoring agent installed for memory metrics, as the hypervisor only reports CPU by default.
