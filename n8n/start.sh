#!/bin/sh
set -e
n8n import:workflow --separate --input=/workflows
n8n update:workflow --all --active=true
exec n8n start
