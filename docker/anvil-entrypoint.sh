#!/bin/sh
chown foundry:foundry /data
exec setpriv --reuid=foundry --regid=foundry --init-groups anvil "$@"
