# n8n for the LendLoop automations, for hosts that build from a repo (e.g. Render).
# On every start it imports the three workflows (same IDs, so re-imports overwrite)
# and activates them. State lives in Postgres, so nothing is lost when the host restarts.
# Docker Hub mirror: docker.n8n.io rate-limits shared build hosts (HTTP 429).
FROM n8nio/n8n:1.123.93

COPY --chown=node:node error-handler.json notify.json overdue-reminders.json /workflows/
COPY --chown=node:node start.sh /home/node/start.sh

ENTRYPOINT ["tini", "--", "/bin/sh", "/home/node/start.sh"]
