@echo off
cd /d "%~dp0..\docker"
docker compose --env-file .env -f docker-compose.yaml -f docker-compose.mls15.yaml down
