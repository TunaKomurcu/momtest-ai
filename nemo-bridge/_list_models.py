from pathlib import Path
import requests

env = {}
for line in Path("../.env.local").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()

key = env.get("NVCF_API_KEY", "")
r = requests.get(
    "https://integrate.api.nvidia.com/v1/models",
    headers={"Authorization": "Bearer " + key},
    timeout=10,
)
models = [m["id"] for m in r.json().get("data", [])]
for m in sorted(models):
    print(m)
