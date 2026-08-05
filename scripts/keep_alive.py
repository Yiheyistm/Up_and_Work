"""
Standalone Keep-Alive Script for Up_and_Work Backend.

Pings the health check endpoint (/api/v1/system/health) to keep free hosting
instances (e.g., Render free tier) awake 24/7.

Usage:
    python scripts/keep_alive.py https://your-app-backend.onrender.com
"""

import sys
import time
import urllib.request
from datetime import datetime

def ping_health_endpoint(backend_url: str) -> bool:
    """Send HTTP GET request to backend health check route."""
    url = backend_url.strip()
    if not url.endswith("/api/v1/system/health"):
        url = url.rstrip("/") + "/api/v1/system/health"
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] Sending keep-alive ping to: {url}")
    
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Up_and_Work-KeepAlive/1.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            print(f"[{timestamp}] ✅ Health check successful (HTTP status: {response.status})")
            return True
    except Exception as err:
        print(f"[{timestamp}] ❌ Health check ping failed: {err}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/keep_alive.py <BACKEND_URL>")
        print("Example: python scripts/keep_alive.py https://up-and-work.onrender.com")
        sys.exit(1)
        
    target_url = sys.argv[1]
    ping_health_endpoint(target_url)
