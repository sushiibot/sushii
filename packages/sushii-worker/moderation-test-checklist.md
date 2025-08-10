# Moderation Feature Testing Checklist

## Core Moderation Actions
### Ban Commands
- [ ] `/ban user:<user> [reason] [dm] [days_to_delete]` - Standard ban
- [ ] `/ban user_id:<id> [reason] [dm] [days_to_delete]` - Ban by user ID
- [ ] `/ban` with attachment - Ban with evidence
- [ ] Ban user not in server
- [ ] Ban with message deletion (0-7 days)
- [ ] Ban with DM notification options (yes/no/default)
- [ ] Ban permission validation (executor has Ban Members)
- [ ] Ban hierarchy validation (can't ban higher roles)

### Temporary Ban Commands  
- [ ] `/tempban user:<user> duration:<time> [reason] [dm]` - Valid durations (1m, 1h, 1d, 1w, etc.)
- [ ] Tempban with invalid duration formats
- [ ] Tempban expiration handling (TempbanTask)
- [ ] List active tempbans with `/tempbanlist`

### Kick Commands
- [ ] `/kick user:<user> [reason] [dm]` - Standard kick
- [x] Kick permission validation
- [x] Kick hierarchy validation

### Timeout Commands
- [ ] `/timeout user:<user> duration:<time> [reason] [dm]` - Valid durations
- [ ] `/untimeout user:<user> [reason] [dm]` - Remove timeout
- [ ] Timeout duration limits (Discord's 28-day max)
- [ ] Native timeout DM handling

### Warning & Note Commands
- [x] `/warn user:<user> reason:<text> [dm]` - Warning with required reason
- [x] `/note user:<user> note:<text>` - Staff note (no DM)
- [ ] Warning/note with attachments

### Unban Commands
- [ ] `/unban user_id:<id> [reason]` - Unban by user ID
- [ ] Unban user not banned
- [ ] Unban permission validation

## Case Management
### History Commands
- [ ] `/history user:<user>` - View user's moderation history
- [ ] `/history user_id:<id>` - History by user ID
- [ ] History pagination (if many cases)
- [ ] History filtering by case types
- [ ] Context menu "User Lookup" command

### Case Operations
- [ ] `/reason case:<number> reason:<text>` - Update case reason
- [ ] `/reason case_range:<start-end> reason:<text>` - Bulk reason update
- [ ] `/uncase case:<number>` - Delete case
- [ ] Case range autocomplete functionality
- [ ] Reason autocomplete from previous cases

### Lookup Commands
- [ ] `/lookup user:<user>` - User information lookup
- [ ] Lookup with user not in server
- [ ] Lookup showing join date, account age, roles, etc.

## Message Management
### Prune Commands
- [ ] `/prune max_delete_count:<2-100>` - Basic message deletion
- [ ] Prune with `after_message_id` filter
- [ ] Prune with `before_message_id` filter  
- [ ] Prune with `user` filter (specific user only)
- [ ] Prune with `skip_pinned` option
- [ ] Prune with `attachments` filter (with/without)
- [ ] Prune with `bots_or_users` filter
- [ ] Message link parsing for before/after filters
- [ ] Prune permission validation (Manage Messages)

### Slowmode Commands
- [ ] `/slowmode duration:<time>` - Set channel slowmode
- [ ] `/slowmode off` - Disable slowmode
- [ ] Slowmode with invalid durations
- [ ] Slowmode permission validation (Manage Channels)

## Audit Log & Mod Log System
### Automatic Logging
- [ ] Ban actions logged to mod log channel
- [ ] Kick actions logged
- [ ] Timeout actions logged
- [ ] Warning actions logged
- [ ] Manual actions vs Discord audit log detection
- [ ] Native timeout detection and DM handling

### Mod Log Components
- [x] "Delete DM" button functionality
- [x] Mod log embed formatting
- [x] Attachment display in mod logs
- [x] Case number assignment and display

## DM Notification System
### DM Policies
- [ ] Guild default DM settings
- [ ] Per-action DM choice override
- [ ] DM content customization via guild config
- [ ] DM failure handling (user has DMs disabled)
- [x] DM deletion via mod log button

### DM Content
- [ ] Standard DM templates
- [ ] Custom guild DM messages
- [ ] 
- [ ] DM with reason included
- [ ] DM with server name/branding
- [ ] Appeal information in DMs

## Permission & Security
### Permission Validation
- [ ] Executor has required permissions for each action type
- [ ] Role hierarchy validation (can't moderate higher roles)
- [ ] Bot role position validation
- [ ] Guild owner exemptions
- [ ] Permission inheritance in threads/forums

### Security Checks
- [ ] Self-moderation prevention (can't ban yourself)
- [ ] Bot protection (can't moderate other bots with higher roles)
- [ ] Rate limiting on moderation actions
- [ ] Audit trail for all moderation actions

## Error Handling & Edge Cases
### Invalid Inputs
- [ ] Invalid user IDs
- [ ] Invalid duration formats
- [ ] Invalid case numbers
- [ ] Invalid message IDs/links
- [ ] Users not found in Discord
- [ ] Missing required parameters

### Discord API Failures
- [ ] User already banned/kicked
- [ ] Insufficient permissions errors
- [ ] Rate limit handling
- [ ] Network timeout handling
- [ ] Guild unavailable scenarios

### Database Issues
- [ ] Case creation failures
- [ ] Duplicate case prevention
- [ ] Database connection issues
- [ ] Migration compatibility

## Integration Testing
### Cross-Feature Integration
- [ ] Cases created for all moderation actions
- [ ] Audit log processing pipeline
- [ ] Tempban task scheduling and execution
- [ ] Guild config integration for DM settings
- [ ] Permission service integration

### Event Handling
- [ ] Discord audit log event processing
- [ ] Member ban/unban events
- [ ] Member timeout events
- [ ] Guild member update events

## Performance & Reliability
- [ ] Bulk moderation actions (multiple targets)
- [ ] Large message prune operations (100 messages)
- [ ] High-frequency moderation scenarios
- [ ] Memory usage during bulk operations
- [ ] Database query optimization