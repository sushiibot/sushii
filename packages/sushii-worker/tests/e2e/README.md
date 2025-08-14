# E2E Testing for Sushii Discord Bot

This directory contains end-to-end tests for the Sushii Discord bot, focusing on deployment state management and blue/green deployment functionality.

## Overview

The e2e tests verify:

- Bot startup and initialization
- Deployment state synchronization between database and bot instances
- Blue/green deployment switchover mechanics
- Health check and metrics endpoints
- Database persistence through bot restarts
- Rapid deployment change handling

## Test Structure

### Test Files

- `deployment-switchover.test.ts` - Core deployment functionality tests
- `deployment-health.test.ts` - Health check and metrics validation tests

### Helper Utilities

- `helpers/deployment-setup.ts` - Main test environment orchestration
- `helpers/docker-utils.ts` - Docker container management
- `helpers/database-utils.ts` - Database operations and verification
- `helpers/health-check-utils.ts` - Health endpoint and metrics utilities

## Prerequisites

### Discord Bot Setup

1. **Create Test Bot Application**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application for testing
   - Create a bot user and get the token
   - Note the Application ID

2. **Create Test Server**:
   - Create a Discord server for testing
   - Add your test bot to the server
   - Create a test channel and note the channel ID
   - Note your Discord User ID

3. **Environment Configuration**:

   ```bash
   # Copy the example environment file
   cp .env.e2e.example .env.e2e

   # Edit .env.e2e with your test bot credentials
   # E2E_DISCORD_TOKEN=your_test_bot_token
   # E2E_APPLICATION_ID=your_test_application_id
   # E2E_OWNER_USER_ID=your_discord_user_id
   # E2E_OWNER_CHANNEL_ID=your_test_channel_id
   # E2E_TEST_CHANNEL_ID=your_test_channel_id
   ```

### System Requirements

- Docker and Docker Compose
- Bun runtime
- Available ports: 5433 (PostgreSQL), 8081-8082 (bot health), 9091-9092 (bot metrics)

## Running Tests

### Quick Start

```bash
# Run full e2e test suite (setup, test, cleanup)
bun run test:e2e:full
```

### Manual Control

```bash
# Setup test environment
bun run test:e2e:setup

# Run tests (environment must be running)
bun run test:e2e

# Cleanup test environment
bun run test:e2e:cleanup
```

### Individual Test Files

```bash
# Run only deployment switchover tests
bun test tests/e2e/deployment-switchover.test.ts

# Run only health and metrics tests
bun test tests/e2e/deployment-health.test.ts
```

## Test Environment

### Docker Services

The e2e tests use the following Docker services:

- **sushii_db_test**: PostgreSQL database (port 5433)
- **sushii_worker_blue_test**: Blue bot instance (health: 8081, metrics: 9091)
- **sushii_worker_green_test**: Green bot instance (health: 8082, metrics: 9092)

### Network Configuration

All services run on the `sushii_test_net` Docker network for isolation.

### Data Persistence

- Database data is ephemeral (cleared between test runs)
- Container logs are available for debugging
- No persistent volumes to avoid test contamination

## Test Scenarios

### Deployment Switchover Tests

1. **Initial State**: Both bots start, verify health
2. **Blue Deployment**: Switch to blue, verify consistency
3. **Green Deployment**: Switch to green, verify consistency
4. **Blue to Green**: Test switchover sequence
5. **Green to Blue**: Test reverse switchover
6. **Database Persistence**: Verify state survives restarts
7. **Rapid Changes**: Test rapid deployment switches

### Health and Metrics Tests

1. **Health Endpoints**: Verify health check responses
2. **Metrics Endpoints**: Verify Prometheus metrics
3. **Deployment State**: Verify deployment info in health responses
4. **Uptime Tracking**: Verify uptime reporting
5. **Restart Recovery**: Verify health after bot restarts
6. **Consistency**: Verify health/metrics consistency

## Debugging

### Container Logs

```bash
# View bot logs
docker logs sushii_worker_blue_test
docker logs sushii_worker_green_test

# View database logs
docker logs sushii_db_test
```

### Health Check Endpoints

```bash
# Check bot health
curl http://localhost:8081/health  # Blue bot
curl http://localhost:8082/health  # Green bot

# Check bot metrics
curl http://localhost:9091/metrics  # Blue bot
curl http://localhost:9092/metrics  # Green bot
```

### Database Access

```bash
# Connect to test database
docker exec -it sushii_db_test psql -U sushii_test -d sushii_test

# Check deployment table
SELECT * FROM app_public.deployments;
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**: Ensure ports 5433, 8081-8082, 9091-9092 are available
2. **Discord Token**: Verify test bot token is valid and bot is in test server
3. **Database Connection**: Check PostgreSQL container is healthy
4. **Container Startup**: Wait for containers to be healthy before running tests

### Test Failures

1. **Timeout Errors**: Increase timeout values in test configuration
2. **Health Check Failures**: Verify bot containers are running and healthy
3. **Database Errors**: Check database schema and migrations
4. **Deployment Inconsistency**: Verify event bus and deployment service functionality

### Environment Cleanup

```bash
# Force cleanup if needed
docker-compose -f ../../docker-compose.e2e.yml down -v --remove-orphans

# Remove test images
docker image prune -f
```

## Architecture Notes

### Test Isolation

- Uses separate Docker network
- Ephemeral database with clean state
- Isolated from development environment
- No external service dependencies

### Deployment Service Testing

- Tests actual deployment service code
- Verifies database persistence layer
- Tests event bus propagation
- Validates blue/green deployment logic

### Health Monitoring

- Tests real health check endpoints
- Verifies Prometheus metrics integration
- Tests deployment state reporting
- Validates uptime tracking

## Contributing

When adding new e2e tests:

1. Follow existing test patterns
2. Use the helper utilities for common operations
3. Ensure proper cleanup in test teardown
4. Add comprehensive error handling
5. Update this README with new test scenarios

## Performance Considerations

- Tests run with minimal resource allocation
- Single shard configuration for simplicity
- Disabled external services (Sentry, tracing, etc.)
- Optimized for fast feedback, not production simulation
