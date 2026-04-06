# Onboarding: Kubernetes

Connect your Kubernetes cluster to Observo to pull node and pod metrics from the metrics-server.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Install metrics-server (if not already running)](#step-1--install-metrics-server-if-not-already-running)
- [Step 2 — Create a read-only ServiceAccount](#step-2--create-a-read-only-serviceaccount)
- [Step 3 — Get the API endpoint and token](#step-3--get-the-api-endpoint-and-token)
- [Step 4 — Add the data source in Observo](#step-4--add-the-data-source-in-observo)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

Observo polls the Kubernetes metrics-server every 60 seconds for:

- Node CPU and memory usage
- Pod CPU and memory usage (per namespace)

---

## Prerequisites

- A running Kubernetes cluster (1.19+)
- `kubectl` configured with cluster-admin access
- `metrics-server` deployed (see Step 1)

---

## Step 1 — Install metrics-server (if not already running)

Check if it's already installed:

```bash
kubectl get deployment metrics-server -n kube-system
```

If not, install it:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

For clusters using self-signed certificates (e.g. kubeadm), add the `--kubelet-insecure-tls` flag:

```bash
kubectl patch deployment metrics-server -n kube-system \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

Verify it's working:

```bash
kubectl top nodes
```

---

## Step 2 — Create a read-only ServiceAccount

Save this as `observo-rbac.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: observo-monitoring
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: observo-monitoring-reader
rules:
  - apiGroups: ["metrics.k8s.io"]
    resources: ["nodes", "pods"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["nodes", "pods", "namespaces"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: observo-monitoring-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: observo-monitoring-reader
subjects:
  - kind: ServiceAccount
    name: observo-monitoring
    namespace: kube-system
---
apiVersion: v1
kind: Secret
metadata:
  name: observo-monitoring-token
  namespace: kube-system
  annotations:
    kubernetes.io/service-account.name: observo-monitoring
type: kubernetes.io/service-account-token
```

Apply it:

```bash
kubectl apply -f observo-rbac.yaml
```

---

## Step 3 — Get the API endpoint and token

### API endpoint

```bash
kubectl cluster-info | grep "Kubernetes control plane"
# Output: Kubernetes control plane is running at https://1.2.3.4:6443
```

### Bearer token

```bash
kubectl get secret observo-monitoring-token -n kube-system \
  -o jsonpath='{.data.token}' | base64 -d
```

Copy the full token string.

---

## Step 4 — Add the data source in Observo

1. Open Observo → **Settings → Data Sources**
2. Click **Add Source**
3. Select **Kubernetes**
4. Fill in the fields:

| Field | Value |
|-------|-------|
| **Name** | A display name, e.g. `Production K8s` |
| **API Endpoint** | The control plane URL, e.g. `https://1.2.3.4:6443` |
| **Bearer Token** | The token from Step 3 |

5. Click **Add & Test**

---

## Troubleshooting

### `Cannot reach Kubernetes API`

- Confirm the API endpoint URL includes the port (usually `:6443`)
- The Observo server must be able to reach the cluster API from its network
- For private clusters, you may need to run Observo inside the cluster or set up a tunnel

### `401 Unauthorized`

The token is invalid or expired. Re-generate it (Step 3) and update the data source.

### `403 Forbidden`

The ServiceAccount does not have the required RBAC permissions. Re-apply `observo-rbac.yaml` and check with:

```bash
kubectl auth can-i list nodes --as=system:serviceaccount:kube-system:observo-monitoring
```

### Certificate errors

If the cluster uses a self-signed certificate, the TLS check may fail. For testing, you can bypass this — but for production, add the cluster CA to the Observo server's trusted certificates.
