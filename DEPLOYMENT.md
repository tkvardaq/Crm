# CRM Tool - Production Deployment Guide

## Architecture Overview

```
                    ┌─────────────────┐
                    │   Traefik SSL   │
                    │  (Auto HTTPS)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
       │   Web App   │ │ Bull Board│ │   Workers   │
       │  (Next.js)  │ │  (Queue UI)│ │  (8+ types) │
       └──────┬──────┘ └─────┬─────┘ └──────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
       │  PostgreSQL │ │   Redis   │ │  LeadStealth│
       │  (pgvector) │ │  (BullMQ) │ │   (Python)  │
       └─────────────┘ └───────────┘ └─────────────┘
```

## Quick Start (Production)

### Prerequisites
- Docker 24+ & Docker Compose 2+
- Domain with DNS A record pointing to server
- Managed PostgreSQL (AWS RDS, GCP Cloud SQL, etc.) - **Recommended**
- Managed Redis (AWS ElastiCache, GCP Memorystore) - **Recommended**
- GitHub Container Registry access (for CI/CD images)

### 1. Server Setup
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose (standalone)
curl -SL https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create app user
useradd -m -s /bin/bash crm
usermod -aG docker crm
```

### 2. Configure Environment
```bash
cd /opt/crm-tool
cp .env.production.example .env.production

# Edit .env.production with your values
# CRITICAL: Generate strong secrets:
# openssl rand -hex 32  # For FERNET_KEY, ENCRYPTION_KEY, NEXTAUTH_SECRET
# openssl rand -base64 32  # For passwords
```

### 3. Deploy
```bash
# Make deploy script executable
chmod +x scripts/deploy.sh

# Deploy
./scripts/deploy.sh production v1.0.0
```

## Zero-Downtime Deployment Strategy

### Blue-Green Deployment (Recommended)
```bash
# 1. Deploy to staging with new version
./scripts/deploy.sh staging v1.0.1

# 2. Run smoke tests
curl -f https://staging.yourdomain.com/api/health

# 3. Switch traffic (update DNS or load balancer)
# 4. Monitor for 10 minutes
# 5. Deploy to production
./scripts/deploy.sh production v1.0.1
```

### Rolling Updates (Current)
The `docker-compose.prod.yml` uses rolling updates:
- `restart: unless-stopped` with health checks
- Traefik waits for health checks before routing traffic
- Workers gracefully handle SIGTERM (30s timeout)

### Database Migrations
```bash
# Migrations run automatically before web starts (migrate service)
# For manual migration:
docker compose -f docker-compose.prod.yml run --rm migrate

# To create new migration:
npm run db:migrate  # Local development
# Then commit the migration files
```

### Rollback Procedure
```bash
# 1. Tag current deployment
docker tag ghcr.io/org/crm-web:v1.0.1 ghcr.io/org/crm-web:rollback-v1.0.0

# 2. Update IMAGE_TAG in deploy script
./scripts/deploy.sh production rollback-v1.0.0

# 3. If migration ran, manual rollback needed:
# docker exec crm-postgres psql -U admin -d crm_db -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;"
# Then manually revert or create down migration
```

## SSL/TLS Configuration

### Automatic (Traefik + Let's Encrypt)
- Traefik automatically provisions certificates
- Stores in `letsencrypt_data` volume
- Renews automatically 30 days before expiry

### Manual Certificates (Alternative)
```yaml
# In docker-compose.prod.yml, replace Traefik labels:
labels:
  - "traefik.http.routers.web.tls=true"
  - "traefik.http.routers.web.tls.certResolver=manual"
  # Mount certs:
volumes:
  - "./certs:/certs:ro"
```

## Monitoring & Observability

### Health Endpoints
- `GET /api/health` - Full health check (DB + Redis)
- `GET /api/ready` - Lightweight readiness probe

### Logging
Structured JSON logs via Pino:
```json
{
  "level": 30,
  "time": "2024-01-15T10:30:00.000Z",
  "service": "crm-tool",
  "version": "1.0.0",
  "environment": "production",
  "requestId": "abc123",
  "userId": "user-123",
  "workspaceId": "ws-123",
  "method": "POST",
  "pathname": "/api/leads",
  "ip": "1.2.3.4",
  "msg": "Request received"
}
```

### Metrics (Planned)
- Prometheus metrics endpoint: `/api/metrics`
- Key metrics: request latency, error rate, queue depth, DB connections

### Alerting (Recommended)
```yaml
# Prometheus alerting rules
groups:
  - name: crm-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.instance }}"
```

## Security Checklist

- [ ] All secrets in secret manager (not .env files)
- [ ] `.env.production` not committed to git
- [ ] Database requires SSL (`sslmode=require`)
- [ ] Redis requires password + TLS
- [ ] Traefik dashboard disabled in production (`--api.insecure=false`)
- [ ] Rate limiting enabled on all API routes
- [ ] CSP headers configured in Next.js
- [ ] Regular dependency scanning (Trivy in CI)
- [ ] Secret scanning (Gitleaks in CI)
- [ ] Backup encryption enabled
- [ ] Audit logging enabled

## Backup & Disaster Recovery

### Automated Backups
- Daily pg_dump at 2 AM UTC
- 7-day retention
- Stored in `backup_data` volume

### Restore Procedure
```bash
# 1. Stop web & workers
docker compose -f docker-compose.prod.yml stop web email-dispatcher ...

# 2. Find backup
ls -la /backups/

# 3. Restore
docker exec crm-postgres pg_restore -U admin -d crm_db /backups/crm_backup_20240115_020000.dump

# 4. Run migrations (if schema changed)
docker compose -f docker-compose.prod.yml run --rm migrate

# 5. Restart services
docker compose -f docker-compose.prod.yml start web email-dispatcher ...
```

### Point-in-Time Recovery (Managed PostgreSQL)
If using RDS/Cloud SQL:
- Enable automated backups + point-in-time recovery
- Recovery target: any second within retention period

## Scaling

### Horizontal Scaling
```yaml
# Scale web replicas (add to docker-compose.prod.yml)
web:
  deploy:
    replicas: 3
    resources:
      limits:
        memory: 1G
        cpus: "2.0"

# Workers scale independently based on queue depth
email-dispatcher:
  deploy:
    replicas: 2
```

### Queue Monitoring
```bash
# Check queue depths
curl https://bull.yourdomain.com/api/queues

# Or via API
curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/queue-stats
```

## Maintenance Windows

### Weekly
- Review error logs
- Check disk space
- Verify backup integrity

### Monthly
- Rotate encryption keys (run `scripts/rotate-keys.ts`)
- Update base Docker images
- Review and apply security patches
- Analyze slow query logs

### Quarterly
- Load test
- Disaster recovery drill
- Capacity planning

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Web health check fails | Check DB/Redis connectivity, run migrations |
| Workers not processing | Check Redis connection, BullMQ queue paused? |
| SSL certificate errors | Verify DNS, check Traefik logs, check ACME rate limits |
| High memory usage | Check for memory leaks, increase limits, restart workers |
| Slow queries | Check Prisma query logs, add indexes, optimize queries |

### Debug Commands
```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f web --tail=100

# Exec into container
docker exec -it crm-web sh

# Check database
docker exec -it crm-postgres psql -U admin -d crm_db

# Check Redis
docker exec -it crm-redis redis-cli -a $REDIS_PASSWORD

# Check queue
curl https://bull.yourdomain.com/api/queues/email-dispatch
```

## Environment-Specific Configs

### Staging
- Use `docker-compose.staging.yml`
- Smaller resource limits
- Mock external APIs (`ADAPTER_MODE=mock`)
- Separate database/Redis

### Development
- Use `docker-compose.dev.yml`
- Hot reload via volumes
- Local PostgreSQL/Redis in containers

## CI/CD Pipeline

See `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`

### Required GitHub Secrets
```
DOCKER_REGISTRY_TOKEN
SSH_PRIVATE_KEY
SSH_HOST
SSH_USER
POSTGRES_PASSWORD
REDIS_PASSWORD
FERNET_KEY
ENCRYPTION_KEY
NEXTAUTH_SECRET
CRON_SECRET
ACME_EMAIL
```

## Support

- Documentation: `/docs`
- API Reference: `/api/docs`
- Monitoring: `https://bull.yourdomain.com`
- Logs: `docker compose logs -f`