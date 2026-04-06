# Onboarding: AWS CloudWatch

Connect your AWS account to Observo to pull EC2, RDS, and other CloudWatch metrics.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Create an IAM user or role](#step-1--create-an-iam-user-or-role)
- [Step 2 — Attach the CloudWatch read policy](#step-2--attach-the-cloudwatch-read-policy)
- [Step 3 — Generate access keys](#step-3--generate-access-keys)
- [Step 4 — Add the data source in Observo](#step-4--add-the-data-source-in-observo)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

Observo polls CloudWatch every 60 seconds. The exact metrics depend on your AWS services, but common ones include:

| Namespace | Typical metrics |
|-----------|----------------|
| `AWS/EC2` | CPUUtilization, NetworkIn, NetworkOut, DiskReadBytes, DiskWriteBytes |
| `AWS/RDS` | CPUUtilization, DatabaseConnections, FreeStorageSpace |
| `AWS/ELB` | RequestCount, HealthyHostCount, Latency |

---

## Prerequisites

- An AWS account with CloudWatch data
- IAM permissions to create users/roles and attach policies

---

## Step 1 — Create an IAM user or role

### Create a dedicated IAM user (simplest)

```bash
aws iam create-user --user-name observo-monitoring
```

### Or use an IAM role (preferred for EC2/ECS deployments)

If Observo runs on EC2 or ECS, attach an IAM role to the instance/task instead of using access keys. Skip Step 3 and leave the access key fields blank.

---

## Step 2 — Attach the CloudWatch read policy

Attach the AWS-managed `CloudWatchReadOnlyAccess` policy:

```bash
aws iam attach-user-policy \
  --user-name observo-monitoring \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess
```

Or create a minimal inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:GetMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Step 3 — Generate access keys

```bash
aws iam create-access-key --user-name observo-monitoring
```

This returns:

```json
{
  "AccessKey": {
    "AccessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  }
}
```

Store the `SecretAccessKey` — it is shown only once.

---

## Step 4 — Add the data source in Observo

1. Open Observo → **Settings → Data Sources**
2. Click **Add Source**
3. Select **AWS CloudWatch**
4. Fill in the fields:

| Field | Value |
|-------|-------|
| **Name** | A display name, e.g. `Production AWS us-east-1` |
| **Region** | AWS region code, e.g. `us-east-1` |
| **Access Key ID** | The `AccessKeyId` from Step 3 |
| **Secret Access Key** | The `SecretAccessKey` from Step 3 |

5. Click **Add & Test**

---

## Troubleshooting

### `Cannot reach AWS CloudWatch in us-east-1`

- Check that the region code is correct (e.g. `eu-west-1`, not `eu-west`)
- Check network connectivity from the Observo server to `monitoring.us-east-1.amazonaws.com`

### `403 Forbidden` when pulling metrics

The IAM user or role does not have `cloudwatch:GetMetricData` permission. Re-attach the policy in Step 2.

### No metrics appear after connection succeeds

Confirm that there are active resources in the region emitting CloudWatch metrics. Newly launched instances can take 5-10 minutes to appear.

### Using IAM roles instead of access keys

If Observo runs inside AWS (EC2, ECS, EKS), leave the access key fields blank and assign the IAM role with `CloudWatchReadOnlyAccess` to the instance/task directly. The AWS SDK will pick up credentials from the instance metadata service automatically.
