#!/bin/sh
set -e
n8n import:workflow --separate --input=/workflows
# The error handler starts from an Error Trigger, which runs when another workflow fails.
# n8n can't activate it, and it doesn't need to be active.
n8n update:workflow --id=LendLoopErrors01 --active=false
n8n update:workflow --id=LendLoopNotify01 --active=true
n8n update:workflow --id=LendLoopOverdue1 --active=true
exec n8n start
