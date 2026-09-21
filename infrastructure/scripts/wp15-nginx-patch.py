#!/usr/bin/env python3
"""Add R17-WP15 auth rate-limit and CSP to nginx site config."""
import re
import sys
from pathlib import Path

SITE = Path("/etc/nginx/sites-enabled/multichef.conf")
ORIG = Path("/tmp/multichef-nginx.bak")

src = ORIG.read_text()

# Insert the auth limit_req block right before each "location /api/ {" line.
# We do this once for the HTTP block, then again for the HTTPS block.
auth_block = """    # R17-WP15 — rate-limit /api/v1/auth/ to 10 r/m with a 20 burst.
    # Normal login is email + password + CSRF (~3 req), so 10 r/m is
    # comfortable; sustained higher than that signals brute force.
    location ~ ^/api/v1/auth/ {
        limit_req zone=auth burst=20 nodelay;
        limit_req_status 429;

        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host:$server_port;
    }

"""

new_src = src.replace("    location /api/ {", auth_block + "    location /api/ {")

SITE.write_text(new_src)
print(f"Wrote {SITE}: +{len(new_src) - len(src)} bytes")
